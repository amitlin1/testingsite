-- ===========================================================================
--  מודל המארזים — docs/packages/PLAN.md
-- ===========================================================================
--
--  "פריט אב / פריט ילד" הופך ל"מארז / פריט במארז". המארז הוא הקופסה: שורת
--  items מסוג מארז (item_types.is_package) עם מסלול משלה; הפריטים שבתוכה
--  מצביעים עליה דרך items.package_id (לשעבר parent_item_id).
--
--  §1  item_types.is_package + package_contents (תכולת מארז)
--  §2  items: package_id, package_seq, package_next_seq, template_snapshot,
--      serial_no nullable; מילוי package_seq לנתונים קיימים
--  §3  test_stations_type.parents_only → package_level
--  §4  item_status 6 — ממתין לפריטי המארז
--  §5  ledger: שינויי שם (package_id, is_package_item), מצב חדש
--      waiting_for_package_items, והפונקציות שנוגעות בעמודות האלה מוחלפות
--      במלואן (metrics_open_run, isi_apply_one, metrics_resync_item_dims)
--  §6  metrics_schema_version → 3
--
--  הנתונים הקיימים: הקישורים הישנים נשמרים כ-package_id ומקבלים package_seq
--  לפי סדר המזהים, כדי שה-constraints יחזיקו. אב ישן הוא מבחינה מבנית
--  "מארז" עד שסקריפט ההסבה (PLAN.md §8) ממיר אותו.
-- ===========================================================================

-- §1 סוגי מארז ותכולה ---------------------------------------------------------

ALTER TABLE "item_types" ADD COLUMN "is_package" BOOLEAN NOT NULL DEFAULT false;
-- Package types only: the route the intake form pre-selects (NULL = 1).
ALTER TABLE "item_types" ADD COLUMN "default_route_number" INTEGER;

CREATE TABLE "package_contents" (
    "id"                SERIAL NOT NULL,
    "package_type_id"   INTEGER NOT NULL,
    "item_type_id"      INTEGER NOT NULL,
    "quantity"          INTEGER NOT NULL,
    "makat"             TEXT,
    "model"             TEXT,
    "manufacturer_name" TEXT,
    "manufacturer_no"   TEXT,
    "manufacturer_sku"  TEXT,
    "route_number"      INTEGER NOT NULL DEFAULT 1,
    "sort_order"        INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "package_contents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "package_contents_quantity_chk" CHECK ("quantity" > 0),
    CONSTRAINT "package_contents_route_chk" CHECK ("route_number" >= 1)
);

CREATE UNIQUE INDEX "package_contents_type_uq" ON "package_contents"("package_type_id", "item_type_id");
CREATE INDEX "idx_package_contents_package_type" ON "package_contents"("package_type_id");

ALTER TABLE "package_contents"
  ADD CONSTRAINT "fk_package_contents_package_type"
  FOREIGN KEY ("package_type_id") REFERENCES "item_types"("item_type_id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "package_contents"
  ADD CONSTRAINT "fk_package_contents_item_type"
  FOREIGN KEY ("item_type_id") REFERENCES "item_types"("item_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- §2 items ---------------------------------------------------------------------

ALTER TABLE "items" RENAME COLUMN "parent_item_id" TO "package_id";
ALTER TABLE "items" RENAME CONSTRAINT "items_parent_item_id_fkey" TO "items_package_id_fkey";

ALTER TABLE "items" ADD COLUMN "package_seq"       SMALLINT;
ALTER TABLE "items" ADD COLUMN "package_next_seq"  SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "items" ADD COLUMN "template_snapshot" JSONB;
ALTER TABLE "items" ALTER COLUMN "serial_no" DROP NOT NULL;

-- Legacy rows: every item that already points at another item gets a
-- position inside it, in item_id order, and the "package" learns the next
-- position to hand out. Structural only — see the header.
UPDATE "items" i
   SET "package_seq" = s.rn
  FROM (SELECT item_id, row_number() OVER (PARTITION BY package_id ORDER BY item_id) AS rn
          FROM "items" WHERE package_id IS NOT NULL) s
 WHERE i.item_id = s.item_id;

UPDATE "items" p
   SET "package_next_seq" = c.n + 1
  FROM (SELECT package_id, count(*) AS n FROM "items" WHERE package_id IS NOT NULL GROUP BY package_id) c
 WHERE p.item_id = c.package_id;

ALTER TABLE "items" ADD CONSTRAINT "items_package_seq_shape" CHECK (("package_id" IS NULL) = ("package_seq" IS NULL));
ALTER TABLE "items" ADD CONSTRAINT "items_package_seq_range" CHECK ("package_seq" IS NULL OR ("package_seq" BETWEEN 1 AND 99));
CREATE UNIQUE INDEX "items_package_seq_uq" ON "items"("package_id", "package_seq");
CREATE INDEX "idx_items_package_id" ON "items"("package_id");

-- §3 עמדות ברמת מארז -----------------------------------------------------------

ALTER TABLE "test_stations_type" RENAME COLUMN "parents_only" TO "package_level";

-- §4 סטטוס 6 -------------------------------------------------------------------
-- A package that reached the closing step before all of its items did.
-- DO NOTHING on purpose: if id 6 is already taken by a locally-defined status
-- the migration must not overwrite it — reconcile by hand.

INSERT INTO "item_status" ("item_status_id", "item_status_desc")
VALUES (6, 'ממתין לפריטי המארז')
ON CONFLICT ("item_status_id") DO NOTHING;

SELECT setval(pg_get_serial_sequence('item_status', 'item_status_id'),
              GREATEST((SELECT max(item_status_id) FROM item_status), 1), true);

-- §5 ledger --------------------------------------------------------------------

ALTER TABLE "route_run"           RENAME COLUMN "parent_item_id" TO "package_id";
ALTER TABLE "route_run"           RENAME COLUMN "is_accessory"   TO "is_package_item";
ALTER TABLE "item_state_interval" RENAME COLUMN "is_accessory"   TO "is_package_item";

-- Three new reasons (§3.4 taxonomy): the box starts waiting for its items,
-- the last item arrives, and a whole box is sent back to its opening step.
-- The reason vocabulary is a CHECK constraint, so it is replaced wholesale
-- (a CHECK cannot be altered in place). The drop is deliberate:
-- metrics-guard: intentional-drop ise_reason_chk
ALTER TABLE item_state_event DROP CONSTRAINT IF EXISTS ise_reason_chk;
ALTER TABLE item_state_event ADD CONSTRAINT ise_reason_chk CHECK (reason IN (
  'item_created','test_started','result_submitted','sent_to_research','returned_to_route',
  'research_note','released_by_user','released_stale','no_station_for_type',
  'station_reassigned','manual_override','legacy_import','correction',
  'package_items_pending','package_items_ready','package_reset'));

-- Waiting state with no station: the package sits before the closing step
-- until its last item arrives. is_waiting so waiting-time queries see it,
-- NOT at_station so it never counts as station work. Sorted between queued
-- and done.
INSERT INTO metric_state
  (state_key, legacy_status_id, label_he, is_terminal, is_waiting, is_active_work, is_research, at_station, sort_order)
VALUES
  ('waiting_for_package_items', 6, 'ממתין לפריטי המארז', false, true, false, false, false, 25)
ON CONFLICT (state_key) DO UPDATE
  SET label_he = EXCLUDED.label_he, legacy_status_id = EXCLUDED.legacy_status_id;

-- metrics_open_run: identical to the ledger migration's text except for the
-- renamed columns. unit_id = COALESCE(package_id, item_id) — the package for
-- an item in a box, the package itself for a package row.
CREATE OR REPLACE FUNCTION metrics_open_run(p_item_id bigint, p_at timestamptz)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_no int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  UPDATE item_state_interval
     SET valid_range = tstzrange(lower(valid_range), p_at, '[)'),
         closed_at   = p_at,
         close_business_date = business_date(p_at),
         exit_reason = 'reroute'
   WHERE item_id = p_item_id AND upper_inf(valid_range) AND is_terminal;

  SELECT 1 + COALESCE(max(run_no), 0) INTO v_no FROM route_run WHERE item_id = p_item_id;

  INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                         opened_at, customer_id, shipment_id, package_id, unit_id,
                         is_package_item, serial_no, is_trusted)
  SELECT ir.item_id, v_no, ir.route_number, ir.item_type_id,
         COALESCE(tr.route_steps, '{}'), md5(COALESCE(tr.route_steps, '{}')::text),
         p_at, it.customer_id, it.shipment_id, it.package_id,
         COALESCE(it.package_id, it.item_id), it.package_id IS NOT NULL,
         COALESCE(TRIM(it.serial_no), ''), true
  FROM item_routes ir
  JOIN items it ON it.item_id = ir.item_id
  LEFT JOIN testing_routes tr
         ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
  WHERE ir.item_id = p_item_id
  RETURNING route_run_id INTO v_run;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'metrics_open_run: no item_routes row for item %', p_item_id;
  END IF;
  RETURN v_run;
END $$;

-- isi_apply_one: the fold. Two changes against the ledger migration's text:
-- the renamed columns, and waiting_for_package_items carries the station TYPE
-- it is blocked before (planned_steps[step_no]) exactly as queued does, so the
-- closing-station queue can be read from the ledger for packages too.
CREATE OR REPLACE FUNCTION isi_apply_one(e item_state_event) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_open item_state_interval; v_ver int;
  v_terminal boolean; v_at_station boolean;
  v_attempt int; v_run route_run; v_sttype int;
  v_prev_at timestamptz; v_prev_seq smallint; v_prev_id bigint;
BEGIN
  IF e.kind <> 'transition' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||e.item_id::text, 0));
  v_ver := current_calendar_version();
  SELECT * INTO v_run FROM route_run WHERE route_run_id = e.route_run_id;

  IF COALESCE(current_setting('app.isi_rebuilding', true), '') = '1' THEN
    SELECT * INTO v_open FROM item_state_interval
     WHERE route_run_id = e.route_run_id AND upper_inf(valid_range) FOR UPDATE;
  ELSE
    SELECT * INTO v_open FROM item_state_interval
     WHERE item_id = e.item_id AND upper_inf(valid_range) FOR UPDATE;
  END IF;

  IF FOUND THEN
    SELECT ev.occurred_at, ev.seq, ev.event_id INTO v_prev_at, v_prev_seq, v_prev_id
      FROM item_state_event ev WHERE ev.event_id = v_open.entry_event_id;

    IF (e.occurred_at, e.seq, e.event_id) < (v_prev_at, v_prev_seq, v_prev_id) THEN
      IF COALESCE(current_setting('app.isi_rebuilding', true), '') = '1' THEN
        RAISE EXCEPTION 'out-of-order event % during rebuild of run %', e.event_id, e.route_run_id;
      END IF;
      PERFORM isi_rebuild_run(v_open.route_run_id);
      RETURN;
    ELSIF (e.occurred_at, e.seq) = (v_prev_at, v_prev_seq) THEN
      IF e.to_state = v_open.state_key THEN RETURN; END IF;
      RAISE EXCEPTION 'zero-length interval for item % (% -> %) at %',
        e.item_id, v_open.state_key, e.to_state, e.occurred_at;
    END IF;

    IF v_open.is_terminal THEN
      UPDATE item_state_interval SET
        valid_range = tstzrange(lower(valid_range), e.occurred_at, '[)'),
        closed_at = e.occurred_at, close_business_date = business_date(e.occurred_at),
        exit_event_id = e.event_id, exit_reason = e.reason
      WHERE interval_id = v_open.interval_id;
    ELSE
      UPDATE item_state_interval SET
        valid_range      = tstzrange(lower(valid_range), e.occurred_at, '[)'),
        closed_at        = e.occurred_at,
        close_business_date = business_date(e.occurred_at),
        exit_event_id    = e.event_id,
        exit_reason      = e.reason,
        exited_by_worker_id   = e.worker_id,
        exited_by_worker_name = e.worker_name,
        wall_seconds     = EXTRACT(EPOCH FROM (e.occurred_at - lower(valid_range))),
        work_seconds     = work_seconds_between(lower(valid_range), e.occurred_at, v_ver),
        calendar_version = v_ver
      WHERE interval_id = v_open.interval_id;
    END IF;
  END IF;

  SELECT is_terminal, at_station INTO v_terminal, v_at_station
    FROM metric_state WHERE state_key = e.to_state;

  IF v_terminal THEN
    UPDATE route_run SET closed_at = e.occurred_at, close_reason = e.reason
     WHERE route_run_id = e.route_run_id AND closed_at IS NULL;
  END IF;

  SELECT 1 + count(*) INTO v_attempt FROM item_state_interval
   WHERE route_run_id = e.route_run_id AND step_no = e.step_no AND state_key = e.to_state;

  v_sttype := CASE
    WHEN v_at_station THEN e.station_type_id
    WHEN e.to_state IN ('queued', 'waiting_for_package_items')
                      THEN NULLIF(v_run.planned_steps[e.step_no], 0)
    ELSE NULL END;

  INSERT INTO item_state_interval (route_run_id,item_id,state_key,is_terminal,step_no,attempt_no,
    station_id,station_type_id,entered_by_worker_id,entered_by_worker_name,
    entry_reason,entry_event_id,valid_range,start_business_date,
    customer_id,shipment_id,item_type_id,unit_id,is_package_item,serial_no,is_trusted)
  VALUES (e.route_run_id,e.item_id,e.to_state,v_terminal,e.step_no,v_attempt,
    CASE WHEN v_at_station THEN e.station_id END, v_sttype,
    CASE WHEN v_at_station THEN e.worker_id END,
    CASE WHEN v_at_station THEN e.worker_name END,
    e.reason,e.event_id,tstzrange(e.occurred_at,NULL,'[)'),business_date(e.occurred_at),
    v_run.customer_id,v_run.shipment_id,v_run.item_type_id,v_run.unit_id,
    v_run.is_package_item,v_run.serial_no, e.is_trusted AND v_run.is_trusted);
END $$;

-- metrics_resync_item_dims: same expressions as metrics_open_run, renamed.
CREATE OR REPLACE FUNCTION metrics_resync_item_dims(p_item_id bigint)
RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n_runs int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  UPDATE route_run rr
     SET customer_id     = it.customer_id,
         shipment_id     = it.shipment_id,
         package_id      = it.package_id,
         unit_id         = COALESCE(it.package_id, it.item_id),
         is_package_item = it.package_id IS NOT NULL,
         serial_no       = COALESCE(TRIM(it.serial_no), '')
    FROM items it
   WHERE it.item_id = p_item_id
     AND rr.item_id = p_item_id
     AND (rr.customer_id, rr.shipment_id, rr.package_id,
          rr.unit_id, rr.is_package_item, rr.serial_no)
         IS DISTINCT FROM
         (it.customer_id, it.shipment_id, it.package_id,
          COALESCE(it.package_id, it.item_id), it.package_id IS NOT NULL,
          COALESCE(TRIM(it.serial_no), ''));
  GET DIAGNOSTICS n_runs = ROW_COUNT;

  UPDATE item_state_interval i
     SET customer_id     = rr.customer_id,
         shipment_id     = rr.shipment_id,
         unit_id         = rr.unit_id,
         is_package_item = rr.is_package_item,
         serial_no       = rr.serial_no
    FROM route_run rr
   WHERE rr.route_run_id = i.route_run_id
     AND i.item_id = p_item_id
     AND (i.customer_id, i.shipment_id, i.unit_id, i.is_package_item, i.serial_no)
         IS DISTINCT FROM
         (rr.customer_id, rr.shipment_id, rr.unit_id, rr.is_package_item, rr.serial_no);

  RETURN n_runs;
END $$;

-- §6 גרסת סכמה ----------------------------------------------------------------
-- The app's write gate (src/app/lib/metrics/schema-gate.ts) requires 3 from
-- this image on: an older image would write parent_item_id / is_accessory
-- into columns that no longer exist.
UPDATE metrics_schema_version SET version = 3, applied_at = now() WHERE id = 1;
