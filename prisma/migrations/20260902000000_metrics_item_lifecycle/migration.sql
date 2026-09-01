-- ===========================================================================
--  מחזור החיים של פריט מול הלדג'ר — מחיקה ועריכה
-- ===========================================================================
--
--  Two write paths reach `items` without going through metrics_record():
--  editing an item and deleting one. Both were written before the ledger
--  existed, and neither can be expressed as an event — an event says "the item
--  moved", and here the item's *identity* changed or the item stopped existing.
--
--  The ledger deliberately keeps no FK to `items` (§3.6: no read query joins
--  items, so the dimensions are frozen onto every row). That is what makes the
--  reads fast, and it is exactly why nothing raised when those two paths
--  skipped it: a deleted item simply kept being counted, forever, from rows
--  nothing pointed at any more.
--
--  §1  deny_mutation gains one sanctioned escape hatch
--  §2  metrics_forget_item     — the item is being hard-deleted
--  §3  metrics_resync_item_dims — the item's frozen dimensions were corrected
--  §4  metrics_refresh_run_plan  — the item's type changed, so its route plan did
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
-- It takes no dimension parameters on purpose: it re-reads items and
-- item_routes with the *same expressions* metrics_open_run uses to freeze them
-- in the first place, so the two can never drift apart. Add a dimension to
-- route_run and there is exactly one other place to change.
--
-- item_type_id is read from item_routes, not from items — that is where
-- metrics_open_run reads it, because the run's planned_steps were resolved for
-- the route's type. Callers that let a user change an item's type must update
-- item_routes as well, or the ledger will keep reporting the route's type.
--
-- Every run and interval of the item is updated, closed history included. The
-- edit dialog corrects master data that was mistyped at intake ("this was
-- always customer 12"), so the honest reading is that the old attribution was
-- never true. A genuine transfer, where history should stay with the previous
-- owner, would need a different call — and an event, not this.
CREATE OR REPLACE FUNCTION metrics_resync_item_dims(p_item_id bigint)
RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n_runs int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  UPDATE route_run rr
     SET customer_id    = it.customer_id,
         shipment_id    = it.shipment_id,
         item_type_id   = ir.item_type_id,
         parent_item_id = it.parent_item_id,
         unit_id        = COALESCE(it.parent_item_id, it.item_id),
         is_accessory   = it.parent_item_id IS NOT NULL,
         serial_no      = COALESCE(TRIM(it.serial_no), '')
    FROM items it
    JOIN item_routes ir ON ir.item_id = it.item_id
   WHERE it.item_id = p_item_id
     AND rr.item_id = p_item_id
     AND (rr.customer_id, rr.shipment_id, rr.item_type_id, rr.parent_item_id,
          rr.unit_id, rr.is_accessory, rr.serial_no)
         IS DISTINCT FROM
         (it.customer_id, it.shipment_id, ir.item_type_id, it.parent_item_id,
          COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
          COALESCE(TRIM(it.serial_no), ''));
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  -- Intervals copy their dimensions from the run at fold time (isi_apply_one),
  -- so they follow the run rather than re-reading items.
  UPDATE item_state_interval i
     SET customer_id  = rr.customer_id,
         shipment_id  = rr.shipment_id,
         item_type_id = rr.item_type_id,
         unit_id      = rr.unit_id,
         is_accessory = rr.is_accessory,
         serial_no    = rr.serial_no
    FROM route_run rr
   WHERE rr.route_run_id = i.route_run_id
     AND i.item_id = p_item_id
     AND (i.customer_id, i.shipment_id, i.item_type_id, i.unit_id, i.is_accessory, i.serial_no)
         IS DISTINCT FROM
         (rr.customer_id, rr.shipment_id, rr.item_type_id, rr.unit_id, rr.is_accessory, rr.serial_no);

  RETURN n_runs;
END $$;

-- §4 metrics_refresh_run_plan -------------------------------------------------
--
-- route_run freezes the route plan it opened under: planned_steps, plan_digest,
-- route_number. Changing an item's *type* changes which testing_routes row
-- applies, so the open run's frozen plan — and the station_type_id the queued
-- interval is waiting for, which is read out of planned_steps — stop matching
-- the route the item is actually on.
--
-- Only ever called for an item that has not started yet (PUT refuses a type
-- change once the item has moved past its first queued step, because a run
-- that already recorded steps under one plan cannot honestly be relabelled
-- with another). For such an item the open run holds exactly one interval, the
-- initial `queued`, so refreshing the plan is a rewrite of a plan nothing has
-- been measured against.
--
-- Returns the number of queued intervals re-pointed.
CREATE OR REPLACE FUNCTION metrics_refresh_run_plan(p_item_id bigint)
RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n int := 0; v_steps int[]; v_route int; v_run bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  -- Same join metrics_open_run uses to resolve the plan in the first place.
  SELECT COALESCE(tr.route_steps, '{}'), ir.route_number, rr.route_run_id
    INTO v_steps, v_route, v_run
    FROM route_run rr
    JOIN item_routes ir ON ir.item_id = rr.item_id
    LEFT JOIN testing_routes tr
           ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
   WHERE rr.item_id = p_item_id AND rr.closed_at IS NULL;

  IF v_run IS NULL THEN RETURN 0; END IF;

  UPDATE route_run
     SET planned_steps = v_steps,
         plan_digest   = md5(v_steps::text),
         route_number  = v_route
   WHERE route_run_id = v_run;

  -- A queued interval waits for planned_steps[step_no] (§3.7, isi_apply_one).
  -- 0 means "no station type for this step" and is stored as NULL.
  UPDATE item_state_interval
     SET station_type_id = NULLIF(v_steps[step_no], 0)
   WHERE route_run_id = v_run
     AND upper_inf(valid_range)
     AND state_key = 'queued'
     AND station_type_id IS DISTINCT FROM NULLIF(v_steps[step_no], 0);
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN n;
END $$;
