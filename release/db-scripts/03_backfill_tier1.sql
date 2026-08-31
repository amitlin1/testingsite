-- STEP 3 of 5  —  BACKFILL: seed the ledger from the items you already have.
--
-- Reads every item_routes row and writes its current state into the ledger, so
-- the new dashboard has something to show from minute one. Safe to run twice —
-- a second run inserts nothing.
--
-- This does NOT invent history. It records where each item is TODAY. Real
-- history accumulates from here as work happens.
--
-- The last statement enables the drift detector, which is what the dual-run
-- week measures.

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
