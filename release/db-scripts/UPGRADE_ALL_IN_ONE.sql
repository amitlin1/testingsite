-- ===========================================================================
--  שדרוג מערכת המטריקות — קובץ אחד להרצה ב-DBeaver
-- ===========================================================================
--
--  מה הוא עושה:
--    1. מתקן עמודה שגולשת ומפילה שמירת מחקר
--    2. יוצר את סכימת הלדג'ר החדשה
--    3. ממלא אותה מהמצב הקיים
--    4. מוסיף סף שחרור אוטומטי לכל סוג תחנה
--
--  מה הוא *לא* עושה: הוא לא מוחק כלום. אף טבלה קיימת לא נמחקת ואף נתון לא
--  הולך לאיבוד. הדשבורד הישן ימשיך לעבוד בדיוק כמו קודם.
--  המחיקה היא קובץ נפרד — 05_DESTRUCTIVE_drop_legacy.sql — שרץ רק שבוע אחרי,
--  אחרי שהבדיקה היומית הוכיחה שהמערכת החדשה נכונה.
--
-- ---------------------------------------------------------------------------
--  איך מריצים
-- ---------------------------------------------------------------------------
--   1. גיבוי טרי של בסיס הנתונים. ולוודא שהוא נטען.
--   2. להתחבר ב-DBeaver *באותו משתמש שאיתו הותקן הקונטיינר*
--      (POSTGRES_USER מקובץ ה-.env של שרת ה-DB). נדרשות הרשאות superuser
--      כדי ליצור extension.
--   3. Alt+X  ("Execute script") — לא Ctrl+Enter. זה סקריפט שלם, לא שאילתה.
--
--  הכול רץ בטרנזקציה אחת: או שהכול נכנס, או ששום דבר לא נכנס. אם משהו נכשל,
--  בסיס הנתונים חוזר בדיוק למצב שלפני ההרצה ותופיע שגיאה שמסבירה מה לתקן.
--  אחרי התיקון אפשר להריץ את הקובץ שוב — הוא בטוח להרצה חוזרת.
--
--  בסוף מוצגות שלוש טבלאות בדיקה. מה צריך לראות בהן כתוב שם.
--
--  אחרי הסקריפט: להעלות את ה-image החדש של האפליקציה, ואז להריץ
--  8-register-tasks.ps1 בהרשאות מנהל (שלוש המשימות המתוזמנות).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  בדיקות מקדימות — נכשלות ברעש לפני שנוגעים במשהו
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE v_dupes text; v_missing text;
BEGIN
  -- הטבלאות שהסקריפט נשען עליהן. אם אחת חסרה, זה בסיס הנתונים הלא נכון.
  SELECT string_agg(t, ', ') INTO v_missing
    FROM unnest(ARRAY['items','item_routes','testing_routes','test_stations',
                      'test_stations_type','shipments','customers','research_history']) AS t
   WHERE to_regclass('public.' || t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'\n\n  זה לא בסיס הנתונים של המערכת — חסרות הטבלאות: %\n', v_missing;
  END IF;

  -- כפילויות שהאינדקס הייחודי החדש לא יוכל לקבל. עדיף לדעת עכשיו, בשם.
  SELECT string_agg(format('(item_type_id=%s, route_number=%s)', item_type_id, route_number), ', ')
    INTO v_dupes
    FROM (SELECT item_type_id, route_number FROM testing_routes
           GROUP BY 1,2 HAVING count(*) > 1) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION E'\n\n  יש מסלולי בדיקה כפולים. צריך למחוק את העודפים לפני השדרוג:\n  %\n', v_dupes;
  END IF;

  RAISE NOTICE 'בדיקות מקדימות עברו.';
END $preflight$;

-- טבלת הרישום של prisma. בהתקנה ותיקה היא לפעמים חסרה, והרישום בסוף הקובץ
-- נשען עליה.
CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id                  varchar(36)  PRIMARY KEY,
  checksum            varchar(64)  NOT NULL,
  finished_at         timestamptz,
  migration_name      varchar(255) NOT NULL,
  logs                text,
  rolled_back_at      timestamptz,
  started_at          timestamptz  NOT NULL DEFAULT now(),
  applied_steps_count integer      NOT NULL DEFAULT 0
);

-- ===========================================================================
--  חלק 1 מתוך 4 — תיקון עמודה שגולשת
--  item_id של מחקר היה קטן מדי, ושמירת מחקר על פריט עם מזהה ארוך נכשלה.
-- ===========================================================================

-- research_history.item_id was int4 while items.item_id / item_routes.item_id are
-- bigint. Item ids are built by string-concatenation (customer/date/counter), so
-- the 10th item of a day for a three-digit customer already exceeds 2^31-1 and
-- the INSERT in /api/testing/results aborts with 22003 (numeric_value_out_of_range).
ALTER TABLE "research_history" ALTER COLUMN "item_id" TYPE BIGINT;

-- ===========================================================================
--  חלק 2 מתוך 4 — סכימת הלדג'ר
--  יוצר את הטבלאות החדשות. לא נוגע בטבלה קיימת מלבד הוספות.
-- ===========================================================================

-- ============================================================================
-- Migration A — metrics ledger, ADDITIVE ONLY (spec: docs/dashboard-migration-plan-v2.md §3.0–§3.11, §8 שלב 2)
--
-- What this is: the complete CIL (Constrained Interval Ledger) schema — 9 new
-- permanent tables, the fold functions, the drift scaffold (created DISABLED),
-- and three additive touches to existing tables (test_results.state_event_id,
-- testing_routes unique index, item_routes FK NOT VALID).
--
-- ADDITIVE ONLY: no existing table loses a column, an index, or a row.
-- Migration B (destructive) ships a full release later, after a green
-- dual-run week.
--
-- The Tier-1 backfill is a SEPARATE file: prisma/backfill/tier1_backfill.sql.
-- It runs inside 8-apply-metrics-ledger.ps1 immediately after this migration
-- (production activation order is stage 2 -> 4 -> 3), and it is the step that
-- ENABLEs trg_metrics_drift. This migration leaves the trigger disabled.
--
-- Every statement is idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT):
-- the air-gap procedure re-runs files against an existing volume.
-- ============================================================================

-- §3.1 Extension + אוצר המילים של המצבים ------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS metric_state (
  state_key        text     PRIMARY KEY,
  legacy_status_id smallint UNIQUE,
  label_he         text     NOT NULL,
  is_terminal      boolean  NOT NULL DEFAULT false,
  is_waiting       boolean  NOT NULL DEFAULT false,
  is_active_work   boolean  NOT NULL DEFAULT false,
  is_research      boolean  NOT NULL DEFAULT false,
  at_station       boolean  NOT NULL DEFAULT false,
  sort_order       smallint NOT NULL
);
INSERT INTO metric_state
  (state_key, legacy_status_id, label_he, is_terminal, is_waiting, is_active_work, is_research, at_station, sort_order)
VALUES
  ('testing',         1, 'בבדיקה',        false, false, true,  false, true,  10),
  ('queued',          2, 'ממתין',         false, true,  false, false, false, 20),
  ('done',            3, 'הושלם',         true,  false, false, false, false, 30),
  ('queued_research', 4, 'ממתין למחקר',   false, true,  false, true,  false, 40),
  ('in_research',     5, 'במחקר',         false, false, true,  true,  true,  50),
  ('unmapped',     NULL, 'סטטוס לא ידוע', false, false, false, false, false, 99)
ON CONFLICT (state_key) DO UPDATE SET label_he = EXCLUDED.label_he;

CREATE OR REPLACE FUNCTION state_of(p_status int) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS
$$ SELECT COALESCE((SELECT state_key FROM metric_state WHERE legacy_status_id = p_status), 'unmapped') $$;

-- §3.2 route_run — מעבר אחד של פריט אחד במסלול אחד ---------------------------

CREATE TABLE IF NOT EXISTS route_run (
  route_run_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id        bigint      NOT NULL,
  run_no         int         NOT NULL DEFAULT 1,
  route_number   int         NOT NULL,
  item_type_id   int         NOT NULL,
  planned_steps  int[]       NOT NULL DEFAULT '{}',
  plan_digest    text        NOT NULL DEFAULT '',
  opened_at      timestamptz NOT NULL,
  closed_at      timestamptz,
  close_reason   text,
  customer_id    int         NOT NULL,
  shipment_id    int         NOT NULL,
  parent_item_id bigint,
  unit_id        bigint      NOT NULL,
  is_accessory   boolean     NOT NULL,
  serial_no      text        NOT NULL DEFAULT '',
  is_trusted     boolean     NOT NULL DEFAULT true,
  CONSTRAINT route_run_uq   UNIQUE (item_id, run_no),
  CONSTRAINT route_run_time CHECK (closed_at IS NULL OR closed_at >= opened_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS route_run_one_open ON route_run(item_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS route_run_closed ON route_run(closed_at) WHERE closed_at IS NOT NULL;

-- §3.3 item_state_event — ה־spine (append-only, immutable) -------------------

CREATE TABLE IF NOT EXISTS item_state_event (
  event_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key       text        NOT NULL,
  route_run_id    bigint      NOT NULL REFERENCES route_run(route_run_id),
  item_id         bigint      NOT NULL,
  occurred_at     timestamptz NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  seq             smallint    NOT NULL DEFAULT 0,
  kind            text        NOT NULL CHECK (kind IN ('transition','note','correction')),
  to_state        text        REFERENCES metric_state(state_key),
  step_no         int         NOT NULL,
  station_id      int,
  station_type_id int,
  worker_id       int,
  worker_name     text,
  reason          text        NOT NULL,
  submit_id       uuid,
  supersedes      bigint      REFERENCES item_state_event(event_id),
  is_trusted      boolean     NOT NULL DEFAULT true,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ise_key_uq UNIQUE (event_key),
  CONSTRAINT ise_reason_chk CHECK (reason IN (
    'item_created','test_started','result_submitted','sent_to_research','returned_to_route',
    'research_note','released_by_user','released_stale','no_station_for_type',
    'station_reassigned','manual_override','legacy_import','correction')),
  CONSTRAINT ise_transition_has_state CHECK (kind <> 'transition' OR to_state IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ise_run   ON item_state_event(route_run_id, occurred_at, seq, event_id);
CREATE INDEX IF NOT EXISTS ise_item  ON item_state_event(item_id, occurred_at);
CREATE INDEX IF NOT EXISTS ise_super ON item_state_event(supersedes) WHERE supersedes IS NOT NULL;

CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING HINT = 'corrections are INSERTs: see the correction recipe (retraction: kind=correction; replacement: kind=transition, reason=correction, supersedes=<event_id>)';
END $$;
DROP TRIGGER IF EXISTS trg_ise_immutable ON item_state_event;
CREATE TRIGGER trg_ise_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON item_state_event
  FOR EACH STATEMENT EXECUTE FUNCTION deny_mutation();

-- §3.5 לוח שנה של עבודה — work_calendar_version + work_span ------------------

CREATE TABLE IF NOT EXISTS work_calendar_version (
  calendar_version int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  horizon_from     date NOT NULL,
  horizon_to       date NOT NULL,
  source_digest    text NOT NULL,
  is_current       boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS wcv_one_current ON work_calendar_version(is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS work_span (
  calendar_version   int    NOT NULL REFERENCES work_calendar_version(calendar_version) ON DELETE CASCADE,
  span_id            bigint GENERATED ALWAYS AS IDENTITY,
  work_date          date   NOT NULL,
  span               tstzrange NOT NULL,
  span_seconds       int    NOT NULL,
  cum_seconds_before bigint NOT NULL,
  PRIMARY KEY (calendar_version, span_id),
  CONSTRAINT work_span_no_overlap EXCLUDE USING gist (calendar_version WITH =, span WITH &&),
  CONSTRAINT work_span_sane CHECK (span_seconds > 0 AND NOT isempty(span))
);
CREATE INDEX IF NOT EXISTS work_span_ladder ON work_span (calendar_version, lower(span));

-- work_span_stage היא TEMP TABLE (ON COMMIT DROP) שנוצרת בטרנזקציית הבנייה
-- על ידי POST /api/cron/rebuild-work-calendar — אין טבלת staging קבועה.
-- האזור נקבע ב-SQL, לא ב-Node (§3.5).
CREATE OR REPLACE FUNCTION work_calendar_build(p_version int) RETURNS int
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n int;
BEGIN
  INSERT INTO work_span (calendar_version, work_date, span, span_seconds, cum_seconds_before)
  SELECT p_version, s.work_date, s.span, s.secs,
         COALESCE(SUM(s.secs) OVER (ORDER BY lower(s.span)
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)
  FROM (
    SELECT st.work_date,
           tstzrange((st.work_date::text || ' ' || st.start_hhmm)::timestamp AT TIME ZONE 'Asia/Jerusalem',
                     (st.work_date::text || ' ' || st.end_hhmm)::timestamp   AT TIME ZONE 'Asia/Jerusalem', '[)') AS span,
           EXTRACT(EPOCH FROM
             ((st.work_date::text || ' ' || st.end_hhmm)::timestamp   AT TIME ZONE 'Asia/Jerusalem'
            - (st.work_date::text || ' ' || st.start_hhmm)::timestamp AT TIME ZONE 'Asia/Jerusalem'))::int AS secs
    FROM work_span_stage st
  ) s
  ORDER BY lower(s.span);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- timestamptz AT TIME ZONE הוא STABLE ולא IMMUTABLE, ולכן business_date
-- לעולם לא יכול להיות GENERATED column. הוא נכתב על ידי פונקציית ה-apply.
CREATE OR REPLACE FUNCTION business_date(ts timestamptz) RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS
$$ SELECT (ts AT TIME ZONE 'Asia/Jerusalem')::date $$;

CREATE OR REPLACE FUNCTION current_calendar_version() RETURNS int
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS
$$ SELECT calendar_version FROM work_calendar_version WHERE is_current $$;

-- שתי גישות אינדקס, לא סריקה על ימים.
-- numeric, NOT bigint: `EXTRACT(EPOCH ...)::bigint` ROUNDS, so two events a
-- microsecond apart could land on offsets a whole second apart. A 0.09s interval
-- then inherited a phantom work-second, work_seconds exceeded wall_seconds, and
-- the generated offhours_seconds went NEGATIVE. Not exotic: the intake wizard
-- emits test_started/result_submitted 1µs apart by design (call site #15).
-- Empirically caught on the seeded dataset — 21 intervals, worst +0.917s.
-- The return type changes, so this must be DROP + CREATE, not OR REPLACE.
DROP FUNCTION IF EXISTS work_seconds_elapsed(timestamptz, int);
CREATE FUNCTION work_seconds_elapsed(p_ts timestamptz, p_ver int)
RETURNS numeric LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((
    SELECT ws.cum_seconds_before
         + LEAST(GREATEST(0, EXTRACT(EPOCH FROM (p_ts - lower(ws.span)))), ws.span_seconds)
    FROM work_span ws
    WHERE ws.calendar_version = p_ver AND lower(ws.span) <= p_ts
    ORDER BY lower(ws.span) DESC LIMIT 1), 0);
$$;

-- מחזיר NULL (ולא 0) מחוץ לאופק שנוצר, כדי שפער יהיה גלוי.
CREATE OR REPLACE FUNCTION work_seconds_between(a timestamptz, b timestamptz, p_ver int DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM work_calendar_version c
                     WHERE c.calendar_version = v
                       AND business_date(LEAST(a,b))    >= c.horizon_from
                       AND business_date(GREATEST(a,b)) <= c.horizon_to) THEN NULL
    ELSE GREATEST(0, work_seconds_elapsed(GREATEST(a,b), v) - work_seconds_elapsed(LEAST(a,b), v))::numeric
  END
  FROM (SELECT COALESCE(p_ver, current_calendar_version()) AS v) s;
$$;

-- §3.6 item_state_interval — ה־ledger ---------------------------------------

CREATE TABLE IF NOT EXISTS item_state_interval (
  interval_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_run_id     bigint      NOT NULL REFERENCES route_run(route_run_id) ON DELETE CASCADE,
  item_id          bigint      NOT NULL,
  state_key        text        NOT NULL REFERENCES metric_state(state_key),
  is_terminal      boolean     NOT NULL DEFAULT false,   -- denormalized מ-metric_state
  step_no          int         NOT NULL,
  attempt_no       int         NOT NULL DEFAULT 1,
  -- סמנטיקת תחנה, נאכפת:
  station_id       int,        -- רק כאשר metric_state.at_station
  station_type_id  int,        -- לתור: הסוג שהפריט ממתין לו; NULL ל-queued_research
  entered_by_worker_id   int,
  entered_by_worker_name text,
  exited_by_worker_id    int,
  exited_by_worker_name  text,
  entry_reason     text        NOT NULL,
  exit_reason      text,
  entry_event_id   bigint      NOT NULL REFERENCES item_state_event(event_id),
  exit_event_id    bigint      REFERENCES item_state_event(event_id),
  valid_range      tstzrange   NOT NULL,
  closed_at        timestamptz,                          -- = upper(valid_range) כשסגור
  start_business_date date     NOT NULL,
  close_business_date date,
  -- ממדים קפואים: אף שאילתת קריאה לא עושה JOIN ל-items/shipments כדי לסנן
  customer_id      int         NOT NULL,
  shipment_id      int         NOT NULL,
  item_type_id     int         NOT NULL,
  unit_id          bigint      NOT NULL,
  is_accessory     boolean     NOT NULL,
  serial_no        text        NOT NULL DEFAULT '',
  -- שני שעונים, ממולאים בסגירה
  wall_seconds     numeric(14,3),
  work_seconds     numeric(14,3),
  offhours_seconds numeric(14,3) GENERATED ALWAYS AS (wall_seconds - work_seconds) STORED,
  calendar_version int,
  is_trusted       boolean     NOT NULL DEFAULT true,
  sys_from         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT isi_shape CHECK (NOT isempty(valid_range) AND lower_inc(valid_range) AND NOT upper_inc(valid_range)),
  CONSTRAINT isi_closed_sync CHECK (closed_at IS NOT DISTINCT FROM upper(valid_range)),
  CONSTRAINT isi_closed_has_wall CHECK (upper_inf(valid_range) OR is_terminal OR wall_seconds IS NOT NULL),
  -- הconstraint. פריט נמצא במצב אחד בדיוק בכל רגע.
  -- DEFERRABLE (still INITIALLY IMMEDIATE): normal operation checks per
  -- statement exactly as before; only isi_rebuild_run defers them, because a
  -- replay of a NON-latest run must transiently recreate an open terminal
  -- interval that a newer run's intervals already bound. Commit-time
  -- enforcement still guarantees no invalid state ever persists.
  CONSTRAINT isi_no_overlap EXCLUDE USING gist (item_id WITH =, valid_range WITH &&)
    DEFERRABLE INITIALLY IMMEDIATE
);
-- One open interval per item. An EXCLUDE constraint rather than a partial
-- unique index for one reason only: constraints can be DEFERRED during
-- isi_rebuild_run, indexes cannot. Semantics are identical.
DO $$ BEGIN
  -- upgrade-in-place from the earlier shape of this file (dev DBs only)
  IF EXISTS (SELECT 1 FROM pg_indexes
             WHERE indexname = 'isi_one_open_per_item' AND tablename = 'item_state_interval')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isi_one_open_per_item') THEN
    DROP INDEX isi_one_open_per_item;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'isi_no_overlap' AND condeferrable) THEN
    ALTER TABLE item_state_interval DROP CONSTRAINT IF EXISTS isi_no_overlap;
    ALTER TABLE item_state_interval ADD CONSTRAINT isi_no_overlap
      EXCLUDE USING gist (item_id WITH =, valid_range WITH &&)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'isi_one_open_per_item') THEN
    ALTER TABLE item_state_interval ADD CONSTRAINT isi_one_open_per_item
      EXCLUDE USING btree (item_id WITH =) WHERE (upper_inf(valid_range))
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- station_id מותר רק במצבים שתחנה מחזיקה בהם, אבל מותר שיהיה חסר
-- (item_routes.test_station_id הוא nullable, ויש מסלולים שמגיעים ל-1/5 בלי תחנה).
ALTER TABLE item_state_interval DROP CONSTRAINT IF EXISTS isi_station_shape;
ALTER TABLE item_state_interval ADD CONSTRAINT isi_station_shape CHECK (
  station_id IS NULL OR state_key IN ('testing','in_research')
);

-- האינדקסים המשניים — ארבעה בלבד; הצרכן של כל אחד ב-§6.2.
-- point-in-time (@>) ו-overlap (&&). כל צרכני ה-@>/&& מסננים NOT is_terminal (ראה §5),
-- ולכן predicate האינדקס מיושר עם predicate השאילתות — והאינדקס באמת בשימוש.
CREATE INDEX IF NOT EXISTS isi_range_live ON item_state_interval USING gist (valid_range)
  WHERE NOT is_terminal;
-- שרשרת intervals של פריט (Q6 LATERAL, מסך היסטוריית פריט)
CREATE INDEX IF NOT EXISTS isi_item_time ON item_state_interval (item_id, valid_range);
-- מטריקות flow/duration (עוגן סגירה) — Q4/Q6/Q8
CREATE INDEX IF NOT EXISTS isi_closed ON item_state_interval (close_business_date, state_key)
  INCLUDE (wall_seconds, work_seconds, unit_id, exit_reason, attempt_no, station_id, station_type_id)
  WHERE closed_at IS NOT NULL;
-- hot path של ה-fold (ספירת attempt_no) + DELETE של rebuild
CREATE INDEX IF NOT EXISTS isi_run ON item_state_interval(route_run_id, step_no, attempt_no);

ALTER TABLE item_state_interval SET (fillfactor = 90);

-- §3.7 ה־fold — metrics_open_run, isi_apply_one, isi_rebuild_run -------------

CREATE OR REPLACE FUNCTION metrics_open_run(p_item_id bigint, p_at timestamptz)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_no int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  -- סגירת interval סופי פתוח, אם יש: אחרת isi_one_open_per_item ו-isi_no_overlap
  -- היו הופכים כל מעבר שני של פריט (rework, manual_override) לכשל constraint
  -- בתוך ה-submit של העובד.
  UPDATE item_state_interval
     SET valid_range = tstzrange(lower(valid_range), p_at, '[)'),
         closed_at   = p_at,
         close_business_date = business_date(p_at),
         exit_reason = 'reroute'
   WHERE item_id = p_item_id AND upper_inf(valid_range) AND is_terminal;

  SELECT 1 + COALESCE(max(run_no), 0) INTO v_no FROM route_run WHERE item_id = p_item_id;

  INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                         opened_at, customer_id, shipment_id, parent_item_id, unit_id,
                         is_accessory, serial_no, is_trusted)
  SELECT ir.item_id, v_no, ir.route_number, ir.item_type_id,
         COALESCE(tr.route_steps, '{}'), md5(COALESCE(tr.route_steps, '{}')::text),
         p_at, it.customer_id, it.shipment_id, it.parent_item_id,
         COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
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

  -- בזמן rebuild, ה-interval הפתוח היחיד שמותר לגעת בו הוא של ה-run המשוחזר:
  -- ב-rebuild של run ישן, לפריט יש interval פתוח של run חדש יותר — סגירתו
  -- הייתה משחיתה את ה-run החי. במסלול חי (לא rebuild) הסקופ לפי item_id נכון.
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

    -- מפתח הסדר המשולש — זהה ל-ORDER BY של isi_rebuild_run. שובר השוויון: event_id.
    IF (e.occurred_at, e.seq, e.event_id) < (v_prev_at, v_prev_seq, v_prev_id) THEN
      IF COALESCE(current_setting('app.isi_rebuilding', true), '') = '1' THEN
        RAISE EXCEPTION 'out-of-order event % during rebuild of run %', e.event_id, e.route_run_id;
      END IF;
      -- בזכות הנעילה+clamp של metrics_record זה בלתי אפשרי במסלול חי;
      -- הענף משרת רק backfill/corrections עם זמנים מפורשים.
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
    WHEN v_at_station          THEN e.station_type_id
    WHEN e.to_state = 'queued' THEN NULLIF(v_run.planned_steps[e.step_no], 0)
    ELSE NULL END;

  INSERT INTO item_state_interval (route_run_id,item_id,state_key,is_terminal,step_no,attempt_no,
    station_id,station_type_id,entered_by_worker_id,entered_by_worker_name,
    entry_reason,entry_event_id,valid_range,start_business_date,
    customer_id,shipment_id,item_type_id,unit_id,is_accessory,serial_no,is_trusted)
  VALUES (e.route_run_id,e.item_id,e.to_state,v_terminal,e.step_no,v_attempt,
    CASE WHEN v_at_station THEN e.station_id END, v_sttype,
    CASE WHEN v_at_station THEN e.worker_id END,
    CASE WHEN v_at_station THEN e.worker_name END,
    e.reason,e.event_id,tstzrange(e.occurred_at,NULL,'[)'),business_date(e.occurred_at),
    v_run.customer_id,v_run.shipment_id,v_run.item_type_id,v_run.unit_id,
    v_run.is_accessory,v_run.serial_no, e.is_trusted AND v_run.is_trusted);
END $$;

CREATE OR REPLACE FUNCTION isi_apply_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN PERFORM isi_apply_one(NEW); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_isi_apply ON item_state_event;
CREATE TRIGGER trg_isi_apply AFTER INSERT ON item_state_event
  FOR EACH ROW EXECUTE FUNCTION isi_apply_event();

CREATE OR REPLACE FUNCTION isi_rebuild_run(p_run bigint)
RETURNS int LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE e item_state_event; n int := 0;
        v_item bigint; v_no int; v_next timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('isi_rebuild:'||p_run::text, 0));
  PERFORM set_config('app.isi_rebuilding', '1', true);

  SELECT item_id, run_no INTO v_item, v_no FROM route_run WHERE route_run_id = p_run;
  IF v_item IS NULL THEN RETURN 0; END IF;

  -- rebuild של run שאינו האחרון: interval ה-done שלו נחתם במקור על ידי פתיחת
  -- ה-run הבא (exit_reason='reroute'), אירוע שלא שייך ל-run הזה — ולכן ה-replay
  -- לבדו היה משאיר אותו פתוח וחופף ל-run הבא. הגבול משוחזר אחרי הלולאה, ועד אז
  -- ה-constraints נדחים לרגע ה-commit (עדיין נאכפים — רק לא באמצע ה-replay).
  SELECT min(opened_at) INTO v_next FROM route_run
   WHERE item_id = v_item AND run_no > v_no;
  SET CONSTRAINTS isi_no_overlap, isi_one_open_per_item DEFERRED;

  DELETE FROM item_state_interval WHERE route_run_id = p_run;
  -- פותחים מחדש את ה-run רק כשהוא האחרון של הפריט; אחרת route_run_one_open
  -- היה נשבר, ו-closed_at המקורי ממילא ישוחזר לאותו ערך על ידי האירוע הסופי.
  UPDATE route_run SET closed_at = NULL, close_reason = NULL
   WHERE route_run_id = p_run AND v_next IS NULL;

  FOR e IN
    SELECT ev.* FROM item_state_event ev
    WHERE ev.route_run_id = p_run AND ev.kind = 'transition'
      AND NOT EXISTS (SELECT 1 FROM item_state_event c WHERE c.supersedes = ev.event_id)
    ORDER BY ev.occurred_at, ev.seq, ev.event_id
  LOOP PERFORM isi_apply_one(e); n := n + 1; END LOOP;

  IF v_next IS NOT NULL THEN
    -- שחזור החתימה שהטיל ה-run הבא — זהה למה ש-metrics_open_run עושה במסלול חי.
    UPDATE item_state_interval
       SET valid_range = tstzrange(lower(valid_range), v_next, '[)'),
           closed_at = v_next,
           close_business_date = business_date(v_next),
           exit_reason = 'reroute'
     WHERE route_run_id = p_run AND upper_inf(valid_range) AND is_terminal;
  END IF;

  PERFORM set_config('app.isi_rebuilding', '0', true);
  RETURN n;
END $$;

-- §4.2 נקודת הכניסה היחידה — metrics_record ----------------------------------

CREATE OR REPLACE FUNCTION metrics_record(
  p_event_key text, p_item_id bigint, p_to_state text, p_step int,
  p_station int, p_station_type int, p_worker int, p_worker_name text,
  p_reason text, p_submit uuid DEFAULT NULL, p_kind text DEFAULT 'transition',
  p_seq smallint DEFAULT 0, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_run bigint; v_id bigint; v_at timestamptz;
        v_existing item_state_event; v_payload jsonb;
BEGIN
  -- (1) נעילה פר-פריט לפני קביעת הזמן. סדר האירועים של פריט = סדר הנעילות,
  --     ולא מרוץ בין clock_timestamp() של טרנזקציות מקבילות.
  PERFORM pg_advisory_xact_lock(hashtextextended('isi:'||p_item_id::text, 0));

  -- (1b) בדיקת replay לפני כל תופעת לוואי. בלעדיה, retry של לקוח על POST סיום
  --     שמגיע אחרי שה-run נסגר היה עובר דרך ה-auto-open למטה: סוגר את interval
  --     ה-done הפתוח עם 'reroute' ופותח run ריק — השחתה שקטה — ורק אז פוגש את
  --     ה-ON CONFLICT. הנעילה ב-(1) עושה סריאליזציה לכל כותבי הפריט, כך
  --     שבדוק-ואז-הכנס לא יכול להתרוץ עבור המפתחות שהפונקציה מייצרת (כולם
  --     item-scoped); ענף ה-ON CONFLICT למטה נשאר כרשת ביטחון.
  SELECT * INTO v_existing FROM item_state_event WHERE event_key = p_event_key;
  IF FOUND THEN
    IF v_existing.to_state IS DISTINCT FROM p_to_state
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.item_id IS DISTINCT FROM p_item_id THEN
      RAISE EXCEPTION 'event_key collision: % already means (item %, %, %) but was asked for (item %, %, %)',
        p_event_key, v_existing.item_id, v_existing.reason, v_existing.to_state,
        p_item_id, p_reason, p_to_state;
    END IF;
    RETURN v_existing.event_id;      -- replay אמיתי, אפס תופעות לוואי
  END IF;

  -- (2) clamp: clock_timestamp() הוא שעון קיר ואינו מונוטוני מובטח (NTP,
  --     host-resume). ה-max() רואה רק שורות מחויבות — הנעילה ב-(1) היא שמבטיחה
  --     שכותב מקביל כבר סיים והתחייב; בלעדיה שני כותבים היו מקבלים אותו clamp.
  v_at := GREATEST(
    clock_timestamp(),
    COALESCE((SELECT max(occurred_at) + interval '1 microsecond'
              FROM item_state_event WHERE item_id = p_item_id), clock_timestamp()));

  v_payload := p_payload;

  SELECT route_run_id INTO v_run FROM route_run
   WHERE item_id = p_item_id AND closed_at IS NULL;

  IF v_run IS NULL AND p_kind = 'transition' THEN
    -- degradation בחן במקום RAISE: פותחים run. metrics_open_run סוגר interval
    -- סופי פתוח אם יש (rework / manual_override על פריט גמור), ופריט ותיק בלי
    -- run (חלון פריסה, שורת legacy) מקבל run במקום להפיל את הגשת העובד ב-500.
    -- פתיחות "מפתיעות" מסומנות ב-payload ונספרות ב-selfcheck.
    v_run := metrics_open_run(p_item_id, v_at);
    IF p_reason NOT IN ('item_created','legacy_import','manual_override') THEN
      v_payload := v_payload || jsonb_build_object('auto_opened_run', true);
    END IF;
  END IF;

  IF v_run IS NULL THEN
    -- notes / corrections נתלים על ה-run האחרון, גם אם נסגר
    SELECT route_run_id INTO v_run FROM route_run
     WHERE item_id = p_item_id ORDER BY run_no DESC LIMIT 1;

    IF v_run IS NULL THEN
      -- לפריט אין אף run: פריט legacy בחלון הפריסה (§4.2 degradation בחן).
      -- בלי זה, שמירת ביניים במחקר (research_note) על פריט כזה מחזירה NULL
      -- ל-recordNote ומפילה את ההגשה ב-500, בזמן שהמעבר המקביל דווקא היה
      -- נפתח אוטומטית. פותחים run גם ל-note — אלא אם הפריט יתום (אין שורת
      -- items), ואז אין על מה לתלות והחזרת NULL היא התשובה הנכונה.
      IF EXISTS (SELECT 1 FROM item_routes ir JOIN items it ON it.item_id = ir.item_id
                  WHERE ir.item_id = p_item_id) THEN
        v_run := metrics_open_run(p_item_id, v_at);
        v_payload := v_payload || jsonb_build_object('auto_opened_run', true);
      ELSE
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  INSERT INTO item_state_event(event_key, route_run_id, item_id, occurred_at, seq, kind, to_state,
      step_no, station_id, station_type_id, worker_id, worker_name, reason, submit_id, payload)
  VALUES (p_event_key, v_run, p_item_id, v_at, p_seq, p_kind, p_to_state,
      p_step, p_station, p_station_type, p_worker, p_worker_name, p_reason, p_submit, v_payload)
  ON CONFLICT (event_key) DO NOTHING
  RETURNING event_id INTO v_id;

  IF v_id IS NULL THEN
    -- כפילות: מוודאים שזו באמת אותה עובדה ולא התנגשות מפתח.
    SELECT * INTO v_existing FROM item_state_event WHERE event_key = p_event_key;
    IF v_existing.to_state IS DISTINCT FROM p_to_state
       OR v_existing.reason IS DISTINCT FROM p_reason
       OR v_existing.item_id IS DISTINCT FROM p_item_id THEN
      RAISE EXCEPTION 'event_key collision: % already means (item %, %, %) but was asked for (item %, %, %)',
        p_event_key, v_existing.item_id, v_existing.reason, v_existing.to_state,
        p_item_id, p_reason, p_to_state;
    END IF;
    RETURN v_existing.event_id;      -- replay אמיתי
  END IF;
  RETURN v_id;
END $$;

-- §3.11 / §4.2: REVOKE ומיד אחריו GRANT מותנה — אחרת מעבר עתידי ל-role
-- לא-superuser היה מקבל 42501 בתוך כל הגשה.
REVOKE EXECUTE ON FUNCTION metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT EXECUTE ON FUNCTION metrics_record(text,bigint,text,int,int,int,int,text,text,uuid,text,smallint,jsonb) TO app_rw;
  END IF;
END $$;

-- §3.8 גלאי ה־drift — פיגום ה־dual-run (נוצר כבוי; נמחק במיגרציה B) ----------

CREATE TABLE IF NOT EXISTS metrics_drift (
  drift_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id       bigint NOT NULL,
  legacy_status smallint,
  ledger_state  text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  occurrences   int NOT NULL DEFAULT 1,
  resolved_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS metrics_drift_open ON metrics_drift(item_id) WHERE resolved_at IS NULL;

-- לא כותב שום מטריקה. רק צועק כשכותב item_routes שכח לקרוא ל-metrics_record.
CREATE OR REPLACE FUNCTION metrics_detect_drift() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_state text; v_status smallint;
BEGIN
  -- קוראים מחדש את השורה כפי שנחתה ב-commit — לא את row-image של ה-UPDATE שתוזמן.
  -- results/route.ts מעדכן את אותה שורת item_routes פעמיים בטרנזקציה אחת
  -- (סטטוס 2 ואז 3 במסלול הסיום). טריגר נדחה מתוזמן פעם לכל אירוע UPDATE, וההפעלה
  -- הראשונה נושאת NEW.current_status=2 בעוד שה-ledger כבר ב-done — השוואה מול NEW
  -- הייתה מייצרת שורת drift מזויפת לכל השלמת מסלול (מאות ביום). השוואה מול השורה
  -- המחויבת גורמת לכל ההפעלות של אותה טרנזקציה להסכים.
  SELECT ir.current_status INTO v_status FROM item_routes ir WHERE ir.item_id = NEW.item_id;
  SELECT i.state_key INTO v_state FROM item_state_interval i
   WHERE i.item_id = NEW.item_id AND upper_inf(i.valid_range);

  IF v_state IS DISTINCT FROM state_of(v_status) THEN
    INSERT INTO metrics_drift(item_id, legacy_status, ledger_state)
    VALUES (NEW.item_id, v_status, v_state)
    ON CONFLICT (item_id) WHERE resolved_at IS NULL
    DO UPDATE SET last_seen_at = now(), occurrences = metrics_drift.occurrences + 1,
                  legacy_status = EXCLUDED.legacy_status, ledger_state = EXCLUDED.ledger_state;
  ELSE
    UPDATE metrics_drift SET resolved_at = now()
     WHERE item_id = NEW.item_id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_metrics_drift ON item_routes;
CREATE CONSTRAINT TRIGGER trg_metrics_drift
  AFTER INSERT OR UPDATE ON item_routes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION metrics_detect_drift();

-- מיגרציה A משאירה את הטריגר כבוי. הוא מופעל כצעד האחרון של Tier-1 backfill
-- באותו סקריפט apply (§8 שלב 4 — prisma/backfill/tier1_backfill.sql).
ALTER TABLE item_routes DISABLE TRIGGER trg_metrics_drift;

-- §3.9 טבלאות תפעול ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS job_run (
  job_run_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name      text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','failed','skipped_overlap')),
  rows_affected bigint, detail jsonb, error_text text, host text
);
CREATE INDEX IF NOT EXISTS job_run_recent ON job_run(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS metrics_schema_version (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version int NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO metrics_schema_version(id, version) VALUES (1, 1)
ON CONFLICT (id) DO UPDATE SET version = GREATEST(metrics_schema_version.version, 1), applied_at = now();

-- §3.10 metrics_selfcheck — 11 בדיקות ---------------------------------------

CREATE OR REPLACE FUNCTION metrics_selfcheck()
RETURNS TABLE(check_name text, value bigint, detail text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT 'open_intervals', count(*)::bigint, NULL::text
    FROM item_state_interval WHERE upper_inf(valid_range)
  UNION ALL SELECT 'drift_open', count(*)::bigint, min(item_id)::text
    FROM metrics_drift WHERE resolved_at IS NULL
  UNION ALL SELECT 'auto_opened_runs', count(*)::bigint, min(item_id)::text
    FROM item_state_event WHERE payload->>'auto_opened_run' = 'true'
  UNION ALL SELECT 'calendar_horizon_days',
       (SELECT (horizon_to - CURRENT_DATE)::bigint FROM work_calendar_version WHERE is_current),
       (SELECT horizon_to::text FROM work_calendar_version WHERE is_current)
  -- "ORDINARY" is the whole point: the sampled day must have NO override and NO
  -- department holiday. Without that filter the check reads a legitimately short
  -- day — an 08:00-14:00 short_day before a holiday is 360, not 455 — and the
  -- health tile goes red for a correct calendar. A monitor that cries wolf on
  -- normal operations is worse than no monitor: the operator learns to ignore
  -- it, and misses the run where the calendar really is broken. `detail` names
  -- the day actually sampled so a surprising value can be checked in one query.
  UNION ALL SELECT 'calendar_sanity_net_minutes',
       (SELECT COALESCE(sum(ws.span_seconds), 0)::bigint / 60 FROM work_span ws
         WHERE ws.calendar_version = current_calendar_version()
           AND ws.work_date = ordinary.d),
       ordinary.d::text
    FROM (SELECT max(ws.work_date) AS d FROM work_span ws
           WHERE ws.calendar_version = current_calendar_version()
             AND EXTRACT(DOW FROM ws.work_date) BETWEEN 0 AND 4
             AND ws.work_date < CURRENT_DATE
             AND NOT EXISTS (SELECT 1 FROM workday_overrides o
                              WHERE o.work_date = ws.work_date)
             AND NOT EXISTS (SELECT 1 FROM department_holidays h
                              WHERE ws.work_date BETWEEN h.start_date AND h.end_date)
         ) ordinary
  UNION ALL SELECT 'intervals_missing_work_seconds', count(*)::bigint, 'calendar gap'
    FROM item_state_interval
    WHERE closed_at IS NOT NULL AND NOT is_terminal AND work_seconds IS NULL
  UNION ALL SELECT 'intervals_stale_calendar', count(*)::bigint, NULL
    FROM item_state_interval
    WHERE closed_at IS NOT NULL AND NOT is_terminal
      AND calendar_version <> current_calendar_version()
  UNION ALL SELECT 'runs_open_past_60d', count(*)::bigint, min(item_id)::text FROM route_run
    WHERE closed_at IS NULL AND opened_at < now() - interval '60 days'
  UNION ALL SELECT 'runs_with_zero_intervals', count(*)::bigint, NULL FROM route_run rr
    WHERE NOT EXISTS (SELECT 1 FROM item_state_interval i WHERE i.route_run_id = rr.route_run_id)
  UNION ALL SELECT 'intervals_at_station_without_station_id', count(*)::bigint, NULL
    FROM item_state_interval WHERE state_key IN ('testing','in_research') AND station_id IS NULL
  -- work_seconds can never exceed wall_seconds — an item cannot work more time
  -- than elapsed. A hit means the calendar arithmetic drifted (this fired for
  -- real once: a rounding cast in work_seconds_elapsed). Kept as a permanent
  -- check so the whole failure class stays visible instead of needing a
  -- one-off script to notice it.
  UNION ALL SELECT 'intervals_negative_offhours', count(*)::bigint, min(interval_id)::text
    FROM item_state_interval WHERE offhours_seconds < 0
  UNION ALL SELECT 'ledger_bytes', pg_total_relation_size('item_state_interval')::bigint, NULL;
$$;

-- §8 שלב 2 — תוספות additive לטבלאות קיימות ---------------------------------

-- test_results מקבלת עוגן אל אירוע ההגשה (call site #14, §4.5).
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS state_event_id bigint;

-- ייחודיות (item_type_id, route_number) — ההנחה של ה-LEFT JOIN ב-metrics_open_run
-- (§3.7). 8-apply-metrics-ledger.ps1 מדפיס דוח כפילויות לפני ה-apply; כאן ה-guard
-- מרים שגיאה ברורה עם רשימת הכפילויות במקום כשל אינדקס אנונימי באמצע apply ידני.
DO $$
DECLARE v_dups text;
BEGIN
  SELECT string_agg(format('(item_type_id=%s, route_number=%s, count=%s)',
                           d.item_type_id, d.route_number, d.cnt), '; ')
    INTO v_dups
  FROM (SELECT item_type_id, route_number, count(*) AS cnt
          FROM testing_routes
         GROUP BY item_type_id, route_number
        HAVING count(*) > 1) d;
  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'cannot create testing_routes_type_number_uq: duplicate (item_type_id, route_number) pairs in testing_routes: %', v_dups
      USING HINT = 'resolve the duplicate testing_routes rows (see the pre-flight duplicates report in 8-apply-metrics-ledger.ps1), then re-run this migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS testing_routes_type_number_uq
  ON testing_routes(item_type_id, route_number);

-- FK של item_routes אל items — NOT VALID: יש שורות item_routes יתומות מוכחות על
-- volume הפרודקשן; דוח היתומים מודפס ב-pre-flight, ו-VALIDATE CONSTRAINT הוא
-- שלב נפרד באישור מפעיל (§8 שלב 2).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ir_item_fk' AND conrelid = 'item_routes'::regclass
  ) THEN
    ALTER TABLE item_routes ADD CONSTRAINT ir_item_fk
      FOREIGN KEY (item_id) REFERENCES items(item_id) NOT VALID;
  END IF;
END $$;

-- ===========================================================================
--  חלק 3 מתוך 4 — מילוי ראשוני
--  רושם את המצב הנוכחי של כל פריט. לא ממציא היסטוריה — היא תצטבר מכאן.
-- ===========================================================================

-- ============================================================================
-- Tier-1 backfill — seeds the metrics ledger from the live operational state
-- (spec: docs/dashboard-migration-plan-v2.md §8 שלב 4, trust policy §4.3).
--
-- Runs INSIDE 8-apply-metrics-ledger.ps1, immediately after Migration A
-- (prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql),
-- with psql -v ON_ERROR_STOP=1. It is re-run at the stage-3 cutover (after
-- stopping the old app, before 3-start.ps1) to cover items created in the
-- window — the whole file is idempotent:
--   * route_run via ON CONFLICT (item_id, run_no) DO NOTHING
--   * seed events via ON CONFLICT (event_key) DO NOTHING (key: legacy:seed:{item_id})
--   * ENABLE TRIGGER is naturally idempotent
--
-- What it does:
--   (א) one route_run per item_routes row that has an items row — INCLUDING
--       finished ones (seeding only in-flight items would zero every live
--       shipment's completion percentage on deploy morning).
--   (ב) one synthetic legacy_import event per run; trg_isi_apply folds it
--       into the interval. Finished runs are seeded as 'done': a terminal
--       interval stays open forever, so wall/work_seconds remain NULL —
--       counts are restored, durations are never invented. That NULL, not
--       the trust flag, is the exclusion mechanism: all Tier-1 rows are
--       is_trusted = true (the facts come from the live operational row,
--       not from a reader's clock — §4.3).
--   (ג) ENABLE TRIGGER trg_metrics_drift — the LAST backfill step, only once
--       the ledger is aligned with item_routes (§8).
--
-- GREATEST clamps: legacy rows written without validation can carry
-- finished_at < created_at; unclamped they would trip route_run_time CHECK
-- and kill the whole backfill under ON_ERROR_STOP.
--
-- Rows that cannot be fully seeded: current_status IN (1,5) AND
-- test_station_id IS NULL — printed by the pre-flight report; the relaxed
-- isi_station_shape admits them with an empty station_id and
-- metrics_selfcheck reports them.
-- ============================================================================

-- (א) route_run לכל שורות item_routes שיש להן שורת items (יתומים דווחו ב-pre-flight)
INSERT INTO route_run (item_id, run_no, route_number, item_type_id, planned_steps, plan_digest,
                       opened_at, closed_at, close_reason,
                       customer_id, shipment_id, parent_item_id, unit_id,
                       is_accessory, serial_no, is_trusted)
SELECT ir.item_id, 1, ir.route_number, ir.item_type_id,
       COALESCE(tr.route_steps,'{}'), md5(COALESCE(tr.route_steps,'{}')::text),
       ir.created_at AT TIME ZONE 'UTC',
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            -- GREATEST: שורת legacy עם finished_at < created_at (נכתבה בלי ולידציה)
            -- הייתה מפילה את route_run_time CHECK ואת כל ה-backfill תחת ON_ERROR_STOP.
            THEN GREATEST(COALESCE(ir.finished_at AT TIME ZONE 'UTC', ir.created_at AT TIME ZONE 'UTC'),
                          ir.created_at AT TIME ZONE 'UTC') END,
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            THEN 'legacy_import' END,
       it.customer_id, it.shipment_id, it.parent_item_id,
       COALESCE(it.parent_item_id, it.item_id), it.parent_item_id IS NOT NULL,
       COALESCE(TRIM(it.serial_no),''), true
FROM item_routes ir
JOIN items it ON it.item_id = ir.item_id
LEFT JOIN testing_routes tr ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
ON CONFLICT (item_id, run_no) DO NOTHING;

-- (ב) אירוע seed אחד לכל run. הטריגר מייצר את ה-interval. אותו clamp GREATEST על הרגע.
INSERT INTO item_state_event (event_key, route_run_id, item_id, occurred_at, seq, kind, to_state,
                              step_no, station_id, station_type_id, reason, is_trusted)
SELECT 'legacy:seed:'||ir.item_id, r.route_run_id, ir.item_id,
       GREATEST(COALESCE(
         CASE WHEN ir.finished_at IS NOT NULL THEN ir.finished_at END,
         CASE WHEN ir.current_status IN (1,5) THEN ir.processing_start_time END,
         ir.queue_start_time, ir.created_at) AT TIME ZONE 'UTC',
         ir.created_at AT TIME ZONE 'UTC'),
       0, 'transition',
       CASE WHEN ir.finished_at IS NOT NULL OR ir.current_status = 3 OR ir.is_finished
            THEN 'done' ELSE state_of(ir.current_status) END,
       ir.current_route_step,
       CASE WHEN ir.current_status IN (1,5) AND ir.finished_at IS NULL THEN ir.test_station_id END,
       (SELECT test_station_type_id FROM test_stations WHERE test_station_id = ir.test_station_id),
       'legacy_import', true
FROM item_routes ir JOIN route_run r ON r.item_id = ir.item_id AND r.run_no = 1
ON CONFLICT (event_key) DO NOTHING;

-- (ג) הפעלת גלאי ה-drift — רק עכשיו, כשה-ledger מיושר עם item_routes.
-- זהו הצעד האחרון של ה-backfill (§8): הפעלה מוקדמת יותר הייתה רושמת drift על
-- כל כתיבה של האפליקציה הישנה מול ledger ריק, ותוקעת את drift_open מעל 0 לנצח.
ALTER TABLE item_routes ENABLE TRIGGER trg_metrics_drift;

-- ============================================================================
-- אימות (שלב 4) — השאילתות שהמפעיל מריץ ומדפיס אחרי ה-backfill.
-- מושארות כהערות; 8-apply-metrics-ledger.ps1 מריץ אותן ומדפיס את התוצאות.
-- ============================================================================

-- 1. שוויון ספירות מול item_routes — עם ה-JOIN בכוונה: יתומים (שורות item_routes
--    בלי שורת items) דווחו בנפרד ב-pre-flight ומוחרגים מהשוויון. שני המספרים
--    חייבים להיות זהים:
--
--    SELECT
--      (SELECT count(*) FROM item_routes ir JOIN items it USING (item_id)) AS item_routes_with_items,
--      (SELECT count(*) FROM route_run WHERE run_no = 1)                   AS route_runs_seeded;

-- 2. interval פתוח אחד לכל run (כולל runs גמורים — interval סופי נשאר פתוח):
--
--    SELECT
--      (SELECT count(*) FROM item_state_interval WHERE upper_inf(valid_range)) AS open_intervals,
--      (SELECT count(*) FROM route_run)                                        AS runs;

-- 3. Q1 ברגע now() מול ספירות item_routes לפי state_of(current_status) —
--    התאמה מדויקת (diff ריק):
--
--    WITH ledger AS (
--      SELECT i.state_key, count(*) AS n
--      FROM item_state_interval i
--      WHERE i.valid_range @> now() AND NOT i.is_terminal AND i.is_trusted
--      GROUP BY i.state_key
--    ), legacy AS (
--      SELECT state_of(ir.current_status) AS state_key, count(*) AS n
--      FROM item_routes ir
--      JOIN items it ON it.item_id = ir.item_id
--      WHERE ir.finished_at IS NULL AND ir.current_status <> 3 AND NOT ir.is_finished
--      GROUP BY 1
--    )
--    SELECT COALESCE(l.state_key, g.state_key) AS state_key,
--           l.n AS ledger_n, g.n AS legacy_n
--    FROM ledger l FULL JOIN legacy g USING (state_key)
--    WHERE l.n IS DISTINCT FROM g.n;

-- 4. Q3 מול station_live_counters (עדיין חיה עד שלב 7) — התאמה מדויקת.
--    האימות החזק ביותר בתוכנית:
--
--    SELECT slc.station_id, slc.items_in_test, q3.in_test
--    FROM station_live_counters slc
--    FULL JOIN (
--      SELECT i.station_id, count(*) FILTER (WHERE i.state_key = 'testing') AS in_test
--      FROM item_state_interval i
--      WHERE i.valid_range @> now() AND NOT i.is_terminal AND i.station_id IS NOT NULL
--      GROUP BY i.station_id
--    ) q3 ON q3.station_id = slc.station_id
--    WHERE COALESCE(slc.items_in_test, 0) IS DISTINCT FROM COALESCE(q3.in_test, 0);

-- 5. selfcheck — מצופה drift_open = 0 ו-intervals_missing_work_seconds = 0:
--
--    SELECT * FROM metrics_selfcheck();

-- ===========================================================================
--  חלק 4 מתוך 4 — סף שחרור לכל סוג תחנה
--  עמודה אחת. 30 דקות כברירת מחדל; 0 = לעולם לא לשחרר אוטומטית.
-- ===========================================================================

-- ============================================================================
-- Per-station-type stale timeout for /api/cron/release-stale-tests.
--
-- WHY: the reaper used to apply one hardcoded 30-minute threshold to every
-- station and to both status 1 (in test) and status 5 (in research). Its job is
-- to catch an ABANDONED dialog (closed laptop, crash, lost tab) — not to cap
-- how long a test may take. A test that legitimately runs for hours is an item
-- physically occupying the bench, and keeping that bench locked is CORRECT.
-- What decides how long a test legitimately runs is the STATION TYPE, so the
-- threshold lives here, next to parents_only.
--
-- SEMANTICS: minutes an item may sit in status 1/5 with no result before the
-- reaper reverts it. 0 = NEVER reap this type (burn-in chambers, research
-- benches that hold a unit for days).
--
-- NOT NULL DEFAULT 30 is the fail-safe: a type created without thinking about
-- this behaves exactly as the whole system did before, and "never release"
-- has to be typed in deliberately.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- existing volume.
-- ============================================================================

ALTER TABLE "test_stations_type"
  ADD COLUMN IF NOT EXISTS "stale_after_minutes" int NOT NULL DEFAULT 30;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'test_stations_type'::regclass
       AND conname  = 'test_stations_type_stale_after_minutes_check'
  ) THEN
    ALTER TABLE "test_stations_type"
      ADD CONSTRAINT "test_stations_type_stale_after_minutes_check"
      CHECK ("stale_after_minutes" >= 0);
  END IF;
END $$;

COMMENT ON COLUMN "test_stations_type"."stale_after_minutes" IS
  'Minutes an item may sit in status 1/5 on a station of this type with no result before /api/cron/release-stale-tests reverts it and frees the station. 0 = never auto-release this type.';

-- ===========================================================================
--  רישום המיגרציות
--  בלי השורות האלה, פריסה עתידית תחשוב שהשדרוג לא רץ ותנסה להריץ אותו שוב.
-- ===========================================================================
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'c85848d5798bed950db32c64d623530f2468d200dd233f83951be948d6ce5e80', now(), '20260824090000_research_history_item_id_bigint', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260824090000_research_history_item_id_bigint');

INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'e126c49e4724f56c3a4fa1779802fa952e3b824e6f838c5af1273625c01545ad', now(), '20260825000000_metrics_ledger_additive', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260825000000_metrics_ledger_additive');

INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '35b07e3b670c1b4c550b72b7fdf3df70e738ccd108e3719626f2558dfe08f3fe', now(), '20260828090000_station_type_stale_timeout', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260828090000_station_type_stale_timeout');

COMMIT;

-- ===========================================================================
--  בדיקה 1 — האם הלדג'ר התמלא?
--  items_with_state צריך להיות שווה ל-item_routes_total (פחות שורות יתומות,
--  אם יש כאלה). אם הוא 0 — שום דבר לא נכנס. לעצור ולברר לפני שמעלים את
--  האפליקציה.
-- ===========================================================================
SELECT (SELECT count(*) FROM item_routes)                        AS item_routes_total,
       (SELECT count(*) FROM route_run)                          AS runs_created,
       (SELECT count(DISTINCT item_id) FROM item_state_interval) AS items_with_state,
       (SELECT count(*) FROM item_state_event)                   AS events;

-- ===========================================================================
--  בדיקה 2 — האם הלדג'ר מסכים עם המצב התפעולי?
--  חייב להחזיר 0. כל מספר אחר אומר שפריט נרשם במצב שונה ממה שהמערכת הישנה
--  חושבת — לברר לפני שממשיכים.
-- ===========================================================================
SELECT count(*) AS items_where_ledger_disagrees
  FROM item_routes ir
  LEFT JOIN item_state_interval i
         ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
 WHERE EXISTS (SELECT 1 FROM item_state_interval x WHERE x.item_id = ir.item_id)
   AND i.state_key IS DISTINCT FROM state_of(ir.current_status);

-- ===========================================================================
--  בדיקה 3 — תקינות כללית
--  כל value חייב להיות 0, חוץ מ:
--    open_intervals               — כמה פריטים חיים יש. מספר גדול זה תקין.
--    calendar_horizon_days        — ריק בשלב הזה. לוח שעות העבודה נבנה אחרי
--                                   שהאפליקציה עולה והמשימה הלילית רצה.
--    calendar_sanity_net_minutes  — אותו דבר.
--    ledger_bytes                 — גודל בדיסק.
-- ===========================================================================
SELECT * FROM metrics_selfcheck();
