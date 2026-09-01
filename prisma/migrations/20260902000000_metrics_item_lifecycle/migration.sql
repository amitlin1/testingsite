-- ===========================================================================
--  מחזור החיים של פריט מול הלדג'ר — מחיקה, עריכה ושינוי סוג
-- ===========================================================================
--
--  Three write paths reach `items` without going through metrics_record():
--  deleting an item, correcting its master data, and changing its type. None of
--  them is a state transition — an event says "the item moved", and here the
--  item stopped existing, or its identity changed, or its whole route was
--  replaced.
--
--  The ledger deliberately keeps no FK to `items` (§3.6: no read query joins
--  items, so the dimensions are frozen onto every row). That is what makes the
--  reads fast, and it is exactly why nothing raised when those paths skipped
--  it: a deleted item simply kept being counted, forever, from rows nothing
--  pointed at any more.
--
--  §1  deny_mutation gains one sanctioned escape hatch
--  §2  metrics_forget_item      — the item is being hard-deleted
--  §3  metrics_resync_item_dims — the item's frozen dimensions were corrected
--  §4  metrics_abandon_run      — the item's type changed; the run is void
-- ===========================================================================

-- §1 חריג יחיד ל-append-only --------------------------------------------------
--
-- item_state_event is append-only, enforced by trg_ise_immutable, and
-- corrections are INSERTs. Erasure is a different thing from a correction:
-- when a row disappears from `items` there is no longer a subject for the
-- events to be about, and a retraction event would still leave the run and its
-- intervals standing.
--
-- The escape hatch is a transaction-local GUC rather than
-- `ALTER TABLE ... DISABLE TRIGGER`, for two reasons: DISABLE takes an ACCESS
-- EXCLUSIVE lock on item_state_event, which would stall every concurrent
-- worker submit for the length of the delete, and it needs table ownership,
-- which the application role has no other reason to hold. The same pattern is
-- already used by isi_rebuild_run with app.isi_rebuilding.
--
-- set_config(..., true) is scoped to the transaction, and metrics_forget_item
-- clears it as soon as its own DELETE returns, so the window is one statement
-- wide. Every other UPDATE / DELETE / TRUNCATE still raises exactly as before.
CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- UPDATE as well as DELETE: metrics_forget_item clears the self-FK
  -- (supersedes) inside the doomed set before removing it. TRUNCATE is never
  -- part of a legitimate erase and stays blocked unconditionally.
  IF current_setting('app.metrics_forget', true) = '1' AND TG_OP IN ('DELETE', 'UPDATE') THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING HINT = 'corrections are INSERTs: see the correction recipe (retraction: kind=correction; replacement: kind=transition, reason=correction, supersedes=<event_id>)';
END $$;

-- §2 metrics_forget_item ------------------------------------------------------
--
-- Erase every ledger trace of one item. Called from DELETE /api/items/[id],
-- in the SAME transaction as the `items` delete — the §4.8 guarantee applies
-- here too: either the item and its ledger both go, or neither does.
--
-- Order is forced by the FKs: intervals reference both route_run and
-- item_state_event, so they go first; events reference route_run, so the run
-- goes last.
--
-- Idempotent: an item with no ledger rows (created before the ledger, or
-- already forgotten) is a no-op. Returns the number of intervals removed,
-- which is what the caller can meaningfully log.
CREATE OR REPLACE FUNCTION metrics_forget_item(p_item_id bigint)
RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n_intervals int := 0;
BEGIN
  -- Same key metrics_open_run and isi_rebuild_run take, so a forget can never
  -- interleave with a fold for the same item.
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  DELETE FROM item_state_interval WHERE item_id = p_item_id;
  GET DIAGNOSTICS n_intervals = ROW_COUNT;

  -- test_results.state_event_id is a bare bigint anchor with no FK (§8), so a
  -- stale value would not raise — it would just point into nothing. The rows
  -- are usually gone already by the time this runs; clearing them here keeps
  -- the function correct whatever order the caller chose.
  UPDATE test_results SET state_event_id = NULL
   WHERE state_event_id IN (SELECT event_id FROM item_state_event WHERE item_id = p_item_id);

  PERFORM set_config('app.metrics_forget', '1', true);

  -- `supersedes` is a self-FK. Corrections always supersede an event on the
  -- same item, so the whole chain is inside the doomed set and one statement
  -- clears it — but a pointer from outside would abort the delete, so drop
  -- those first rather than trusting the invariant.
  UPDATE item_state_event SET supersedes = NULL
   WHERE supersedes IN (SELECT event_id FROM item_state_event WHERE item_id = p_item_id)
     AND item_id <> p_item_id;

  DELETE FROM item_state_event WHERE item_id = p_item_id;

  PERFORM set_config('app.metrics_forget', '', true);

  DELETE FROM route_run WHERE item_id = p_item_id;

  -- metrics_drift is dual-run scaffolding: it exists only between the additive
  -- migration and the destructive drop a week later, which removes it. This
  -- function has to work on both sides of that, and plpgsql resolves a static
  -- table reference at execution time -- so a plain DELETE here would start
  -- failing the moment the legacy drop ran.
  IF to_regclass('public.metrics_drift') IS NOT NULL THEN
    EXECUTE 'DELETE FROM metrics_drift WHERE item_id = $1' USING p_item_id;
  END IF;

  RETURN n_intervals;
END $$;

-- §3 metrics_resync_item_dims -------------------------------------------------
--
-- Push the item's current dimensions back onto its frozen copies. Called from
-- PUT /api/items/[id] after the `items` update, in the same transaction.
--
-- It takes no dimension parameters on purpose: it re-reads items with the
-- *same expressions* metrics_open_run uses to freeze them in the first place,
-- so the two can never drift apart. Add a dimension to route_run and there is
-- exactly one other place to change.
--
-- item_type_id is deliberately NOT synced here. Every other dimension is a
-- correction of master data mistyped at intake ("this was always customer 12"),
-- so the honest reading is that the old value was never true. The type is
-- different: it decides which route the item walks, so changing it ends the
-- current run and starts a new one (§4). The abandoned run really did happen
-- under the old type, and relabelling it would move measured work onto a route
-- that never ran it.
CREATE OR REPLACE FUNCTION metrics_resync_item_dims(p_item_id bigint)
RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n_runs int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  UPDATE route_run rr
     SET customer_id    = it.customer_id,
         shipment_id    = it.shipment_id,
         parent_item_id = it.parent_item_id,
         unit_id        = COALESCE(it.parent_item_id, it.item_id),
         is_accessory   = it.parent_item_id IS NOT NULL,
         serial_no      = COALESCE(TRIM(it.serial_no), '')
    FROM items it
   WHERE it.item_id = p_item_id
     AND rr.item_id = p_item_id
     AND (rr.customer_id, rr.shipment_id, rr.parent_item_id,
          rr.unit_id, rr.is_accessory, rr.serial_no)
         IS DISTINCT FROM
         (it.customer_id, it.shipment_id, it.parent_item_id,
          COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
          COALESCE(TRIM(it.serial_no), ''));
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- Intervals copy their dimensions from the run at fold time (isi_apply_one),
  -- so they follow the run rather than re-reading items. item_type_id is left
  -- alone here for the same reason it is above.
  UPDATE item_state_interval i
     SET customer_id  = rr.customer_id,
         shipment_id  = rr.shipment_id,
         unit_id      = rr.unit_id,
         is_accessory = rr.is_accessory,
         serial_no    = rr.serial_no
    FROM route_run rr
   WHERE rr.route_run_id = i.route_run_id
     AND i.item_id = p_item_id
     AND (i.customer_id, i.shipment_id, i.unit_id, i.is_accessory, i.serial_no)
         IS DISTINCT FROM
         (rr.customer_id, rr.shipment_id, rr.unit_id, rr.is_accessory, rr.serial_no);

  RETURN n_runs;
END $$;

-- §4 metrics_abandon_run ------------------------------------------------------
--
-- Changing an item's type sends it back to the start of a different route:
-- another type can have entirely different stations, so the steps already
-- walked mean nothing on the new route. In ledger terms the current run is
-- over — but it did NOT finish, and that distinction is the whole point of
-- this function.
--
-- "Finished" has exactly one definition in the read path (§5.3ב): a run whose
-- closed_at is set. Closing an abandoned run the ordinary way would therefore
-- add it to the completion count, the completion percentage and both turnaround
-- averages — an item counted as delivered because someone corrected its type.
-- `is_trusted = false` is the sanctioned way out: every query that counts
-- closures carries `rr.is_trusted` for exactly this purpose, so an untrusted run
-- stays in the audit trail and out of the numbers.
--
-- The intervals keep their own is_trusted. That time really was spent, at real
-- stations, by real people, so station load and queue durations should still
-- see it. Only the route *completion* is void.
--
-- Afterwards the caller records a fresh `queued` transition. metrics_record
-- finds no open run and calls metrics_open_run, which reads item_routes — by
-- then already pointing at the new type — and freezes the new route's plan onto
-- run_no + 1.
--
-- Returns the abandoned route_run_id, or NULL when the item had no open run.
CREATE OR REPLACE FUNCTION metrics_abandon_run(p_item_id bigint, p_reason text)
RETURNS bigint
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_at timestamptz; v_ver int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  SELECT route_run_id INTO v_run FROM route_run
   WHERE item_id = p_item_id AND closed_at IS NULL;
  IF v_run IS NULL THEN
    RETURN NULL;
  END IF;

  -- metrics_record clamps occurred_at forward past the item's last event, so an
  -- open interval can legitimately start slightly in the future. Closing at a
  -- plain clock_timestamp() would then build an empty or inverted range and trip
  -- isi_shape. Stay one microsecond past the newest open interval.
  SELECT GREATEST(clock_timestamp(),
                  COALESCE(max(lower(i.valid_range)), clock_timestamp())
                    + interval '1 microsecond')
    INTO v_at
    FROM item_state_interval i
   WHERE i.item_id = p_item_id AND upper_inf(i.valid_range);

  v_ver := current_calendar_version();

  -- Closed exactly the way isi_apply_one closes an interval on a transition:
  -- both clocks filled, business date stamped, calendar version pinned.
  UPDATE item_state_interval SET
    valid_range         = tstzrange(lower(valid_range), v_at, '[)'),
    closed_at           = v_at,
    close_business_date = business_date(v_at),
    exit_reason         = p_reason,
    wall_seconds        = EXTRACT(EPOCH FROM (v_at - lower(valid_range))),
    work_seconds        = work_seconds_between(lower(valid_range), v_at, v_ver),
    calendar_version    = v_ver
   WHERE item_id = p_item_id AND upper_inf(valid_range) AND NOT is_terminal;

  -- A terminal interval carries no durations (§3.6), so it closes without them.
  UPDATE item_state_interval SET
    valid_range         = tstzrange(lower(valid_range), v_at, '[)'),
    closed_at           = v_at,
    close_business_date = business_date(v_at),
    exit_reason         = p_reason
   WHERE item_id = p_item_id AND upper_inf(valid_range) AND is_terminal;

  UPDATE route_run
     SET closed_at    = v_at,
         close_reason = p_reason,
         is_trusted   = false
   WHERE route_run_id = v_run;

  RETURN v_run;
END $$;
