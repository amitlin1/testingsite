-- =============================================================================
-- שדרוג DB הייצור למודל המארזים — הכול בפעולה אחת
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20260915120000_package_model/migration.sql   (הסכימה)
--   scripts/prod-package-model/03-fix-production.sql   (סידור הנתונים)
--
-- מה קורה כשמריצים (בסדר הזה, הכול או כלום):
--   א. בדיקות מקדימות: הסכימה ישנה, המיגרציה לא רשומה, סטטוס 6 פנוי.
--   ב. המיגרציה: טבלת package_contents, עמודות המארז על items, package_level
--      על סוגי העמדות, סטטוס 6, שינויי ה-ledger.
--   ג. רישום המיגרציה ב-_prisma_migrations (הגרסה החדשה לא תריץ אותה שוב).
--   ד. סידור הנתונים: שורות מסלול יתומות, דגלי פתיחה/סגירה, סוגי מארז
--      ותכולות, תיקון מסלולים, הצהרות המשלוחים לפי סוגי מארז, והמרת כל
--      פריט ישן למארז עם מזהה חדש (ledger, קבצים ורשומות מחקר עוברים איתו).
--   ה. אם קבוצה כלשהי חסומה — שגיאה עם הסיבה, ושום דבר לא נשמר.
--
-- לפני ההרצה: לעצור את האפליקציה, ולהריץ את 1-backup-before-packages.ps1.
--
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script). בסוף מוצגות שתי
-- לשוניות: הדוח, ומיפוי המזהים ישן→חדש. המיפוי נשמר גם בטבלה legacy_id_map.
-- הרצה חוזרת מסרבת לרוץ ("הסכימה כבר שודרגה") — זה תקין.
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-upgrade-to-packages.sql
-- =============================================================================

DROP TABLE IF EXISTS fix_report;
CREATE TEMP TABLE fix_report (ord serial, step text, detail text);
DROP TABLE IF EXISTS fix_idmap;
CREATE TEMP TABLE fix_idmap (legacy_id bigint, new_id bigint, package_id bigint, package_seq int, item_type text, serial_no text, shipment_code text);
DROP TABLE IF EXISTS fix_group;
CREATE TEMP TABLE fix_group (
  item_id bigint, customer_id int, item_type_id int, type_desc text, shipment_id int, serial_no text, makat text,
  model text, manufacturer_name text, manufacturer_no text, current_status int, current_route_step int,
  is_finished boolean, route_number int, created_at timestamp, queue_start_time timestamp, ord int, new_route_number int
);

DO $upgrade$
DECLARE
  -- ======================= CONFIG — ערוך כאן =================================
  -- סוג העמדה שפותח מארז (שלב 1 של כל מסלול) וסוג העמדה שסוגר אותו (השלב האחרון).
  cfg_opening_type text := 'צילום';
  cfg_closing_type text := 'אריזה';
  -- סוגי עמדה שמוסרים ממסלולי הפריטים (לא יכולים לשבת אחרי הסגירה).
  cfg_remove_from_item_routes text[] := ARRAY['דוח סופי'];
  -- סוגי המארז ותכולתם. סוג פריט שלא קיים ייווצר.
  cfg_packages jsonb := '[
    {"name": "מארז מחשב",        "contents": [{"type": "מחשב", "qty": 1}, {"type": "עכבר", "qty": 1}, {"type": "מקלדת", "qty": 1}]},
    {"name": "מארז KVM 4 PORTS", "contents": [{"type": "KVM 4 PORTS", "qty": 1}]},
    {"name": "מארז KVM 8 PORTS", "contents": [{"type": "KVM 8 PORTS", "qty": 1}]}
  ]';
  -- סוג פריט ישן ברמה העליונה → סוג המארז שכל פריט כזה הופך אליו (קופסה לכל פריט).
  cfg_legacy_map jsonb := '{"KVM 4 PORTS": "מארז KVM 4 PORTS", "KVM 8 PORTS": "מארז KVM 8 PORTS"}';
  -- פריט שנשלח למחקר מהתור (סטטוס 4, שלב 1, בלי תוצאות): 'reset' = ממירים
  -- ומחזירים לממתין (רשומות המחקר עוברות למזהה החדש); 'skip' = משאירים כמו שהוא.
  cfg_research_policy text := 'reset';
  -- פריט עם קבצים מצורפים: 'move' = הקבצים עוברים למזהה החדש; 'skip' = לא ממירים.
  cfg_files_policy text := 'move';
  -- שורת מסלול של פריט שלא קיים: למחוק (true) או רק לדווח (false).
  cfg_delete_orphan_routes boolean := true;
  -- true = אם קבוצה כלשהי חסומה, לא לשמור כלום.
  cfg_strict boolean := true;
  -- ============================================================================

  v_open int; v_close int; v_pkg_levels int[];
  r record; g record; ln record; x record;
  v_n int; v_txt text; v_id int; v_ct int; v_sort int;
  v_steps int[]; v_new_steps int[]; v_mid int[];
  v_content_types int[] := '{}'; v_mapped_types int[] := '{}';
  v_target text; v_pkg_type int; v_problems text[]; v_rows int;
  v_date_part text; v_date_key date; v_counter int; v_base text; v_package_id bigint; v_new_id bigint;
  v_station int; v_pkg_steps int[]; v_item_steps int[]; v_line_route int;
  v_blocked int := 0; v_converted int := 0; v_seq int;
  v_template jsonb;
BEGIN
  -- ============================================================ א. בדיקות
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'parent_item_id') THEN
    RAISE EXCEPTION 'הסכימה כבר שודרגה (אין items.parent_item_id) — הסקריפט כבר רץ. לא בוצע כלום.';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'המיגרציה 20260915120000_package_model כבר רשומה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'route_run') THEN
    RAISE EXCEPTION 'טבלאות ה-ledger חסרות (route_run) — חסרות מיגרציות קודמות. לא בוצע כלום.';
  END IF;
  IF EXISTS (SELECT 1 FROM item_status WHERE item_status_id = 6 AND TRIM(item_status_desc) <> 'ממתין לפריטי המארז') THEN
    RAISE EXCEPTION 'סטטוס 6 תפוס בשם אחר — יש לפנות אותו לפני השדרוג. לא בוצע כלום.';
  END IF;
  IF cfg_research_policy NOT IN ('reset', 'skip') OR cfg_files_policy NOT IN ('move', 'skip') THEN
    RAISE EXCEPTION 'CONFIG: ערך לא חוקי ב-cfg_research_policy / cfg_files_policy';
  END IF;
  INSERT INTO fix_report(step, detail) VALUES ('0 סביבה', current_database() || ' · ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  -- ============================================================ ב. המיגרציה
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

  PERFORM setval(pg_get_serial_sequence('item_status', 'item_status_id'),
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


  -- ============================================================ ג. רישום
  INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid()::text, 'c4130d6ef545240422dd3e8d06937c6d089b2317b7a7e59c06896a4e7dc218d3', now(), '20260915120000_package_model', NULL, NULL, now(), 1);
  INSERT INTO fix_report(step, detail) VALUES ('0 מיגרציה', '20260915120000_package_model הוחלה ונרשמה');

  -- ============================================================ ד. הנתונים
  -- ------------------------------------------------- 1. שורות מסלול יתומות
  FOR r IN SELECT ir.item_id FROM item_routes ir WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.item_id = ir.item_id) LOOP
    IF cfg_delete_orphan_routes THEN
      PERFORM metrics_forget_item(r.item_id);
      DELETE FROM item_routes WHERE item_id = r.item_id;
      INSERT INTO fix_report(step, detail) VALUES ('1 שורות מסלול יתומות', 'נמחקה שורת מסלול (וה-ledger) של פריט שלא קיים: ' || r.item_id);
    ELSE
      INSERT INTO fix_report(step, detail) VALUES ('1 שורות מסלול יתומות', 'נמצאה ולא נמחקה (cfg): ' || r.item_id);
    END IF;
  END LOOP;

  -- ------------------------------------------------------------ 2. סטטוס 6
  SELECT TRIM(item_status_desc) INTO v_txt FROM item_status WHERE item_status_id = 6;
  IF v_txt IS NULL THEN
    INSERT INTO item_status (item_status_id, item_status_desc) VALUES (6, 'ממתין לפריטי המארז');
    INSERT INTO fix_report(step, detail) VALUES ('2 סטטוסים', 'נוסף סטטוס 6 "ממתין לפריטי המארז"');
  ELSIF v_txt <> 'ממתין לפריטי המארז' THEN
    RAISE EXCEPTION 'סטטוס 6 תפוס בשם "%" — יש לפנות אותו', v_txt;
  ELSE
    INSERT INTO fix_report(step, detail) VALUES ('2 סטטוסים', 'סטטוס 6 קיים');
  END IF;

  -- ------------------------------------------------- 3. עמדות ברמת מארז
  SELECT test_station_type_id INTO v_open  FROM test_stations_type WHERE TRIM(test_type_desc) = cfg_opening_type;
  SELECT test_station_type_id INTO v_close FROM test_stations_type WHERE TRIM(test_type_desc) = cfg_closing_type;
  IF v_open IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג עמדת הפתיחה "%" לא קיים', cfg_opening_type; END IF;
  IF v_close IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג עמדת הסגירה "%" לא קיים', cfg_closing_type; END IF;
  IF v_open = v_close THEN RAISE EXCEPTION 'CONFIG: הפתיחה והסגירה חייבות להיות שני סוגי עמדה שונים'; END IF;
  IF NOT EXISTS (SELECT 1 FROM test_stations WHERE test_station_type_id = v_open AND status <> 3) THEN
    RAISE EXCEPTION 'אין אף עמדה פעילה מסוג הפתיחה "%"', cfg_opening_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM test_stations WHERE test_station_type_id = v_close AND status <> 3) THEN
    RAISE EXCEPTION 'אין אף עמדה פעילה מסוג הסגירה "%"', cfg_closing_type;
  END IF;
  FOR r IN SELECT test_station_type_id AS id, TRIM(test_type_desc) AS d, package_level AS old_flag FROM test_stations_type ORDER BY 1 LOOP
    IF (r.id IN (v_open, v_close)) <> r.old_flag THEN
      UPDATE test_stations_type SET package_level = (r.id IN (v_open, v_close)) WHERE test_station_type_id = r.id;
      INSERT INTO fix_report(step, detail) VALUES ('3 עמדות ברמת מארז', '#' || r.id || ' ' || r.d || ': package_level ' || r.old_flag || ' → ' || (r.id IN (v_open, v_close)));
    END IF;
  END LOOP;
  v_pkg_levels := ARRAY[v_open, v_close];
  INSERT INTO fix_report(step, detail) VALUES ('3 עמדות ברמת מארז', 'פתיחה = #' || v_open || ' ' || cfg_opening_type || ' · סגירה = #' || v_close || ' ' || cfg_closing_type);

  -- ------------------------------------------- 4. סוגי מארז ותכולה ומסלולם
  FOR r IN SELECT value AS pkg FROM jsonb_array_elements(cfg_packages) LOOP
    v_txt := r.pkg ->> 'name';
    IF v_txt IS NULL OR length(v_txt) > 50 THEN RAISE EXCEPTION 'CONFIG: שם סוג מארז חסר או ארוך מ-50: %', v_txt; END IF;
    SELECT item_type_id INTO v_id FROM item_types WHERE TRIM(item_type_desc) = v_txt;
    IF v_id IS NULL THEN
      INSERT INTO item_types (item_type_desc, is_package) VALUES (v_txt, true) RETURNING item_type_id INTO v_id;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'נוצר סוג מארז #' || v_id || ' "' || v_txt || '"');
    ELSE
      UPDATE item_types SET is_package = true WHERE item_type_id = v_id AND NOT is_package;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'סוג מארז #' || v_id || ' "' || v_txt || '" קיים' || CASE WHEN FOUND THEN ' · סומן is_package' ELSE '' END);
    END IF;
    IF EXISTS (SELECT 1 FROM items WHERE item_type_id = v_id AND package_id IS NOT NULL) THEN
      RAISE EXCEPTION 'סוג המארז "%" משמש פריטים בתוך מארזים — לא יכול להיות סוג מארז', v_txt;
    END IF;

    v_sort := 0;
    FOR ln IN SELECT value AS line FROM jsonb_array_elements(r.pkg -> 'contents') LOOP
      v_txt := ln.line ->> 'type';
      IF v_txt IS NULL OR length(v_txt) > 50 THEN RAISE EXCEPTION 'CONFIG: שם סוג תכולה חסר או ארוך מ-50: %', v_txt; END IF;
      SELECT item_type_id INTO v_ct FROM item_types WHERE TRIM(item_type_desc) = v_txt;
      IF v_ct IS NULL THEN
        INSERT INTO item_types (item_type_desc, is_package) VALUES (v_txt, false) RETURNING item_type_id INTO v_ct;
        INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'נוצר סוג פריט #' || v_ct || ' "' || v_txt || '" (תכולה)');
      END IF;
      IF (SELECT is_package FROM item_types WHERE item_type_id = v_ct) THEN
        RAISE EXCEPTION 'CONFIG: "%" הוא סוג מארז ולא יכול להיות תכולה', v_txt;
      END IF;
      INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order)
      VALUES (v_id, v_ct, GREATEST(COALESCE((ln.line ->> 'qty')::int, 1), 1), 1, v_sort)
      ON CONFLICT (package_type_id, item_type_id) DO UPDATE SET quantity = EXCLUDED.quantity, sort_order = EXCLUDED.sort_order;
      v_content_types := array_append(v_content_types, v_ct);
      v_sort := v_sort + 1;
    END LOOP;
    INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', '"' || (r.pkg ->> 'name') || '" תכולה: ' ||
      (SELECT string_agg(TRIM(it.item_type_desc) || ' ×' || pc.quantity, ', ' ORDER BY pc.sort_order)
         FROM package_contents pc JOIN item_types it ON it.item_type_id = pc.item_type_id WHERE pc.package_type_id = v_id));

    -- מסלול המארז: [פתיחה, סגירה]
    SELECT route_steps INTO v_steps FROM testing_routes WHERE item_type_id = v_id AND route_number = 1;
    IF NOT FOUND THEN
      INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES (v_id, v_open, ARRAY[v_open, v_close], 1);
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'מסלול 1 של "' || (r.pkg ->> 'name') || '" נוצר: ' || v_open || '→' || v_close);
    ELSIF v_steps IS DISTINCT FROM ARRAY[v_open, v_close] THEN
      UPDATE testing_routes SET route_steps = ARRAY[v_open, v_close], test_station_type_id = v_open WHERE item_type_id = v_id AND route_number = 1;
      INSERT INTO fix_report(step, detail) VALUES ('4 סוגי מארז', 'מסלול 1 של "' || (r.pkg ->> 'name') || '" תוקן: ' || array_to_string(v_steps, '→') || ' ⇒ ' || v_open || '→' || v_close);
    END IF;
  END LOOP;

  -- הסוגים הישנים שממופים (המפתחות של cfg_legacy_map)
  FOR r IN SELECT key AS legacy, value AS target FROM jsonb_each_text(cfg_legacy_map) LOOP
    SELECT item_type_id INTO v_id FROM item_types WHERE TRIM(item_type_desc) = r.legacy;
    IF v_id IS NULL THEN RAISE EXCEPTION 'CONFIG: סוג ישן "%" לא קיים', r.legacy; END IF;
    IF NOT EXISTS (SELECT 1 FROM item_types WHERE TRIM(item_type_desc) = r.target AND is_package) THEN
      RAISE EXCEPTION 'CONFIG: יעד המיפוי "%" אינו סוג מארז מוגדר', r.target;
    END IF;
    v_mapped_types := array_append(v_mapped_types, v_id);
  END LOOP;

  -- ----------------------------------------------- 5. מסלולי הפריטים
  FOR r IN SELECT tr.test_route_id, tr.item_type_id, TRIM(it.item_type_desc) AS d, tr.route_number, tr.route_steps
             FROM testing_routes tr JOIN item_types it ON it.item_type_id = tr.item_type_id
            WHERE NOT it.is_package AND (tr.item_type_id = ANY (v_content_types) OR tr.item_type_id = ANY (v_mapped_types))
            ORDER BY 2, 4
  LOOP
    -- האמצע: בלי הסוגים להסרה, בלי עמדות ברמת מארז; ואז פתיחה בהתחלה וסגירה בסוף.
    SELECT COALESCE(array_agg(s ORDER BY o), '{}') INTO v_mid
      FROM unnest(COALESCE(r.route_steps, '{}')) WITH ORDINALITY u(s, o)
     WHERE s <> ALL (v_pkg_levels)
       AND s NOT IN (SELECT test_station_type_id FROM test_stations_type WHERE TRIM(test_type_desc) = ANY (cfg_remove_from_item_routes));
    v_new_steps := ARRAY[v_open] || v_mid || ARRAY[v_close];
    IF v_new_steps IS DISTINCT FROM r.route_steps THEN
      UPDATE testing_routes SET route_steps = v_new_steps, test_station_type_id = v_open WHERE test_route_id = r.test_route_id;
      INSERT INTO fix_report(step, detail) VALUES ('5 מסלולי פריטים', '#' || r.item_type_id || ' ' || r.d || ' · מסלול ' || r.route_number || ': ' || array_to_string(r.route_steps, '→') || ' ⇒ ' || array_to_string(v_new_steps, '→'));
    END IF;
  END LOOP;
  FOR r IN SELECT DISTINCT t.item_type_id, TRIM(it.item_type_desc) AS d
             FROM unnest(v_content_types || v_mapped_types) t(item_type_id) JOIN item_types it ON it.item_type_id = t.item_type_id
            WHERE NOT EXISTS (SELECT 1 FROM testing_routes tr WHERE tr.item_type_id = t.item_type_id AND tr.route_number = 1)
  LOOP
    INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES (r.item_type_id, v_open, ARRAY[v_open, v_close], 1);
    INSERT INTO fix_report(step, detail) VALUES ('5 מסלולי פריטים', '#' || r.item_type_id || ' ' || r.d || ' · מסלול 1 נוצר: ' || v_open || '→' || v_close || ' (אין שלבים באמצע — להשלים בהגדרות)');
  END LOOP;

  -- ------------------------------------------------------------ 6. משלוחים
  FOR r IN SELECT s.id, s.shipment_code, s.amount FROM shipments s ORDER BY s.id LOOP
    FOR ln IN SELECT si.id AS line_id, si.item_type_id, TRIM(it.item_type_desc) AS d, si.quantity, it.is_package
                FROM shipment_items si JOIN item_types it ON it.item_type_id = si.item_type_id WHERE si.shipment_id = r.id ORDER BY si.id
    LOOP
      IF ln.is_package THEN CONTINUE; END IF;
      v_target := cfg_legacy_map ->> ln.d;
      IF v_target IS NOT NULL THEN
        SELECT item_type_id INTO v_pkg_type FROM item_types WHERE TRIM(item_type_desc) = v_target AND is_package;
        UPDATE shipment_items SET item_type_id = v_pkg_type WHERE id = ln.line_id;
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' ⇒ "' || v_target || '" ×' || ln.quantity);
      ELSIF ln.item_type_id = ANY (v_content_types) THEN
        DELETE FROM shipment_items WHERE id = ln.line_id;
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' נמחקה (סוג תכולה, נספר בתוך המארז)');
      ELSE
        INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', '!! ' || r.shipment_code || ': הצהרה "' || ln.d || '" ×' || ln.quantity || ' מסוג שאינו מארז ואינו ממופה — נשארה; העריכה במסך תידחה עד שתמופה');
      END IF;
    END LOOP;
    SELECT COALESCE(sum(quantity), 0) INTO v_n FROM shipment_items WHERE shipment_id = r.id;
    IF v_n <> COALESCE(r.amount, 0) THEN
      UPDATE shipments SET amount = v_n WHERE id = r.id;
      INSERT INTO fix_report(step, detail) VALUES ('6 משלוחים', r.shipment_code || ': כמות כוללת ' || COALESCE(r.amount, 0) || ' ⇒ ' || v_n || ' מארזים');
    END IF;
  END LOOP;

  -- ------------------------------------------------- 7. המרת הקבוצות הישנות
  FOR g IN SELECT i.item_id, i.customer_id, i.item_type_id, TRIM(it.item_type_desc) AS type_desc, i.shipment_id, i.makat,
                  TRIM(COALESCE(s.makat, '')) AS shipment_makat, s.shipment_code,
                  ir.current_status, ir.current_route_step, ir.is_finished, ir.created_at, ir.queue_start_time,
                  to_char(ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem', 'DDMMYY') AS date_part,
                  (ir.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jerusalem')::date AS date_key
             FROM items i
             JOIN item_types it ON it.item_type_id = i.item_type_id
             LEFT JOIN item_routes ir ON ir.item_id = i.item_id
             LEFT JOIN shipments s ON s.id = i.shipment_id
            WHERE i.package_id IS NULL AND NOT it.is_package
            ORDER BY i.item_id
  LOOP
    v_problems := '{}';
    v_target := cfg_legacy_map ->> g.type_desc;
    v_pkg_type := NULL;
    IF v_target IS NULL THEN
      v_problems := array_append(v_problems, 'אין מיפוי לסוג "' || g.type_desc || '"');
    ELSE
      SELECT item_type_id INTO v_pkg_type FROM item_types WHERE TRIM(item_type_desc) = v_target AND is_package;
    END IF;
    IF g.customer_id > 999 THEN v_problems := array_append(v_problems, 'לקוח ' || g.customer_id || ' לא נכנס ל-3 ספרות'); END IF;
    IF g.created_at IS NULL THEN v_problems := array_append(v_problems, 'אין שורת מסלול לפריט הראשי'); END IF;

    -- הקבוצה: הפריט הראשי ואחריו הילדים לפי מיקומם
    TRUNCATE fix_group;
    INSERT INTO fix_group
    SELECT i.item_id, i.customer_id, i.item_type_id, TRIM(it.item_type_desc), i.shipment_id, i.serial_no, i.makat,
           i.model, i.manufacturer_name, i.manufacturer_no, ir.current_status, ir.current_route_step, ir.is_finished,
           ir.route_number, ir.created_at, ir.queue_start_time,
           CASE WHEN i.item_id = g.item_id THEN 0 ELSE 1 END * 1000000 + COALESCE(i.package_seq, 0), NULL
      FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id LEFT JOIN item_routes ir ON ir.item_id = i.item_id
     WHERE i.item_id = g.item_id OR i.package_id = g.item_id;
    SELECT count(*) INTO v_rows FROM fix_group;
    IF v_rows > 99 THEN v_problems := array_append(v_problems, v_rows || ' פריטים — מארז מכיל עד 99'); END IF;

    FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
      IF x.current_status IS NULL THEN
        v_problems := array_append(v_problems, x.item_id || ': אין שורת מסלול');
      ELSIF NOT ((x.current_status = 2 AND x.current_route_step = 1 AND NOT COALESCE(x.is_finished, false))
              OR (cfg_research_policy = 'reset' AND x.current_status = 4 AND x.current_route_step = 1 AND NOT COALESCE(x.is_finished, false))) THEN
        v_problems := array_append(v_problems, x.item_id || ': נגעו בו (סטטוס ' || x.current_status || ', שלב ' || x.current_route_step || CASE WHEN x.is_finished THEN ', הסתיים' ELSE '' END || ')');
      END IF;
      IF EXISTS (SELECT 1 FROM test_results t WHERE t.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש תוצאות בדיקה'); END IF;
      IF EXISTS (SELECT 1 FROM item_route_history h WHERE h.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש היסטוריית עמדות'); END IF;
      IF cfg_research_policy <> 'reset' AND EXISTS (SELECT 1 FROM research_history h WHERE h.item_id = x.item_id) THEN v_problems := array_append(v_problems, x.item_id || ': יש רשומות מחקר'); END IF;
      IF cfg_files_policy <> 'move' AND EXISTS (SELECT 1 FROM file_objects f WHERE f.entity_type = 'item_attachment' AND f.status <> 'deleted' AND f.entity_id = x.item_id::text) THEN
        v_problems := array_append(v_problems, x.item_id || ': יש קבצים מצורפים');
      END IF;
      IF (SELECT is_package FROM item_types WHERE item_type_id = x.item_type_id) THEN v_problems := array_append(v_problems, x.item_id || ': מסוג מארז'); END IF;
    END LOOP;

    -- התאמת מסלולים למארז
    IF v_pkg_type IS NOT NULL THEN
      SELECT route_steps INTO v_pkg_steps FROM testing_routes WHERE item_type_id = v_pkg_type AND route_number = 1;
      IF v_pkg_steps IS DISTINCT FROM ARRAY[v_open, v_close] THEN v_problems := array_append(v_problems, 'מסלול המארז אינו [פתיחה, סגירה]'); END IF;
      FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
        SELECT route_number INTO v_line_route FROM package_contents WHERE package_type_id = v_pkg_type AND item_type_id = x.item_type_id;
        v_line_route := COALESCE(v_line_route, 1);
        UPDATE fix_group SET new_route_number = v_line_route WHERE item_id = x.item_id;
        SELECT route_steps INTO v_item_steps FROM testing_routes WHERE item_type_id = x.item_type_id AND route_number = v_line_route;
        IF v_item_steps IS NULL OR array_length(v_item_steps, 1) < 2 THEN
          v_problems := array_append(v_problems, x.item_id || ' (' || x.type_desc || '): אין מסלול ' || v_line_route);
        ELSIF v_item_steps[1] <> v_open OR v_item_steps[array_length(v_item_steps, 1)] <> v_close
           OR EXISTS (SELECT 1 FROM unnest(v_item_steps[2:array_length(v_item_steps, 1) - 1]) s WHERE s = ANY (v_pkg_levels)) THEN
          v_problems := array_append(v_problems, x.item_id || ' (' || x.type_desc || '): מסלול ' || v_line_route || ' [' || array_to_string(v_item_steps, '→') || '] לא מתחיל בפתיחה / לא מסתיים בסגירה');
        END IF;
      END LOOP;
    END IF;

    IF array_length(v_problems, 1) > 0 THEN
      v_blocked := v_blocked + 1;
      INSERT INTO fix_report(step, detail) VALUES ('7 חסום', g.item_id || ' (' || g.type_desc || ', ' || v_rows || ' שורות): ' || array_to_string(v_problems, ' | '));
      CONTINUE;
    END IF;

    -- ---- ההמרה עצמה ----
    INSERT INTO daily_counters (date_key, counter) VALUES (g.date_key, 1)
    ON CONFLICT (date_key) DO UPDATE SET counter = daily_counters.counter + 1
    RETURNING counter INTO v_counter;
    IF v_counter > 9999 THEN RAISE EXCEPTION 'המונה היומי של % עבר 9999', g.date_key; END IF;
    v_base := '1' || lpad(g.customer_id::text, 3, '0') || g.date_part || lpad(v_counter::text, 4, '0');
    v_package_id := (v_base || '00')::bigint;

    SELECT test_station_id INTO v_station FROM test_stations
     WHERE test_station_type_id = v_open AND status <> 3 ORDER BY (status = 2) DESC, test_station_id LIMIT 1;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type_id', item_type_id, 'quantity', quantity, 'makat', makat, 'model', model,
             'manufacturer_name', manufacturer_name, 'manufacturer_no', manufacturer_no, 'manufacturer_sku', manufacturer_sku,
             'route_number', route_number, 'sort_order', sort_order) ORDER BY sort_order, id), '[]'::jsonb)
      INTO v_template FROM package_contents WHERE package_type_id = v_pkg_type;

    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no,
                       shipment_id, package_id, package_seq, package_next_seq, template_snapshot)
    VALUES (v_package_id, g.customer_id, v_pkg_type, NULL, COALESCE(NULLIF(g.shipment_makat, ''), TRIM(g.makat), ''), '', '', '',
            g.shipment_id, NULL, NULL, v_rows + 1, v_template);
    INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
    VALUES (v_package_id, v_pkg_type, 2, 1, v_station, g.created_at, false, COALESCE(g.queue_start_time, g.created_at), 1);

    v_seq := 0;
    FOR x IN SELECT * FROM fix_group ORDER BY ord LOOP
      v_seq := v_seq + 1;
      v_new_id := (v_base || lpad(v_seq::text, 2, '0'))::bigint;
      SELECT route_steps INTO v_item_steps FROM testing_routes WHERE item_type_id = x.item_type_id AND route_number = x.new_route_number;
      SELECT test_station_id INTO v_station FROM test_stations
       WHERE test_station_type_id = v_item_steps[1] AND status <> 3 ORDER BY (status = 2) DESC, test_station_id LIMIT 1;
      INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no, shipment_id, package_id, package_seq)
      VALUES (v_new_id, x.customer_id, x.item_type_id, x.serial_no, x.makat, x.model, x.manufacturer_name, COALESCE(x.manufacturer_no, ''), x.shipment_id, v_package_id, v_seq);
      INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
      VALUES (v_new_id, x.item_type_id, 2, 1, v_station, x.created_at, false, COALESCE(x.queue_start_time, x.created_at), x.new_route_number);

      UPDATE research_history SET item_id = v_new_id WHERE item_id = x.item_id;
      UPDATE file_objects SET entity_id = v_new_id::text WHERE entity_type = 'item_attachment' AND entity_id = x.item_id::text;

      INSERT INTO fix_idmap VALUES (x.item_id, v_new_id, v_package_id, v_seq, x.type_desc, x.serial_no, g.shipment_code);
    END LOOP;

    -- ledger: המזהים הישנים נשכחים, החדשים נולדים עכשיו בשלב 1
    FOR x IN SELECT item_id FROM fix_group LOOP PERFORM metrics_forget_item(x.item_id); END LOOP;
    PERFORM metrics_record('legacy_import:' || v_package_id, v_package_id, 'queued', 1, NULL, v_open, NULL, NULL, 'legacy_import');
    FOR x IN SELECT m.new_id, tr.route_steps[1] AS first_step
               FROM fix_idmap m JOIN items i ON i.item_id = m.new_id
               JOIN item_routes ir ON ir.item_id = m.new_id
               JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
              WHERE m.package_id = v_package_id
    LOOP
      PERFORM metrics_record('legacy_import:' || x.new_id, x.new_id, 'queued', 1, NULL, x.first_step, NULL, NULL, 'legacy_import');
    END LOOP;

    -- השורות הישנות: מסלולים, ילדים, ואז הראשי
    DELETE FROM item_routes WHERE item_id IN (SELECT item_id FROM fix_group);
    DELETE FROM items WHERE package_id = g.item_id;
    DELETE FROM items WHERE item_id = g.item_id;

    v_converted := v_converted + 1;
    INSERT INTO fix_report(step, detail) VALUES ('7 הומר', g.item_id || ' (' || g.type_desc || ') ⇒ מארז ' || v_package_id || ' "' || v_target || '" · ' || v_rows || ' פריטים · קליטה ' || g.date_key);
  END LOOP;

  -- ------------------------------------------------------------- 8. סיכום
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'קבוצות שהומרו: ' || v_converted || ' · חסומות: ' || v_blocked);
  SELECT count(*) INTO v_n FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE it.is_package AND i.package_id IS NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'מארזים במערכת: ' || v_n);
  SELECT count(*) INTO v_n FROM items WHERE package_id IS NOT NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'פריטים בתוך מארזים: ' || v_n);
  SELECT count(*) INTO v_n FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE NOT it.is_package AND i.package_id IS NULL;
  INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'פריטים ישנים שנשארו מחוץ למארז: ' || v_n);
  FOR r IN SELECT s.shipment_code, s.amount,
                  (SELECT count(*) FROM items i JOIN item_types it ON it.item_type_id = i.item_type_id WHERE i.shipment_id = s.id AND it.is_package AND i.package_id IS NULL) AS boxes
             FROM shipments s ORDER BY s.id
  LOOP
    INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'משלוח ' || r.shipment_code || ': הוצהרו ' || r.amount || ' · נקלטו ' || r.boxes || ' מארזים');
  END LOOP;
  SELECT count(*) INTO v_n FROM (SELECT serial_no FROM items WHERE serial_no IS NOT NULL AND TRIM(serial_no) <> '' GROUP BY 1 HAVING count(*) > 1) d;
  IF v_n > 0 THEN INSERT INTO fix_report(step, detail) VALUES ('8 סיכום', 'לתשומת לב: ' || v_n || ' סריאלים כפולים (לא שונו)'); END IF;

  IF cfg_strict AND v_blocked > 0 THEN
    RAISE EXCEPTION 'cfg_strict: % קבוצות חסומות — לא נשמר כלום', v_blocked;
  END IF;
END
$upgrade$;

-- מיפוי המזהים נשמר גם בטבלה קבועה, לא רק בלשונית
-- Read by the app: /api/testing/locate-by-barcode answers a scan of an OLD label
-- through it, and /packages offers new labels for every box whose
-- relabeled_at is still NULL (set when they are printed). Not in
-- schema.prisma; guarded in scripts/check-migration-safety.js.
CREATE TABLE IF NOT EXISTS legacy_id_map (
  legacy_id bigint, new_id bigint, package_id bigint, package_seq int, item_type text, serial_no text, shipment_code text,
  converted_at timestamptz NOT NULL DEFAULT now(),
  relabeled_at timestamptz
);
-- A map created by the first version of this file lacks the column; harmless on a new one.
ALTER TABLE legacy_id_map ADD COLUMN IF NOT EXISTS relabeled_at timestamptz;
CREATE INDEX IF NOT EXISTS legacy_id_map_legacy_idx ON legacy_id_map (legacy_id);
INSERT INTO legacy_id_map (legacy_id, new_id, package_id, package_seq, item_type, serial_no, shipment_code)
SELECT legacy_id, new_id, package_id, package_seq, item_type, serial_no, shipment_code FROM fix_idmap;

-- הדוח (לשונית 1) ומיפוי המזהים (לשונית 2)
SELECT step, detail FROM fix_report ORDER BY ord;
SELECT package_id, package_seq, new_id, legacy_id, item_type, serial_no, shipment_code FROM fix_idmap ORDER BY package_id, package_seq;
