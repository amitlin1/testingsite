-- ===========================================================================
-- STEP 5 of 5  —  MIGRATION B.  *** THIS ONE CANNOT BE UNDONE ***
-- ===========================================================================
--
-- Drops 26 legacy tables, a materialized view, a trigger and two functions.
-- Re-deploying the old application image does NOT bring them back. The only
-- recovery is a restore from backup, which costs you everything written since
-- that backup.
--
-- DO NOT RUN THIS ON THE SAME DAY AS STEPS 1-4.
--
-- Run it only when ALL of these are true:
--   1. Steps 1-4 have been live for a FULL WEEK.
--   2. Every day of that week, the query below returned 0.
--   3. You have a fresh backup and you have verified it restores.
--
-- The daily check (run this every day of the week, before step 5):
--
--   SELECT count(*) AS open_drift FROM metrics_drift WHERE resolved_at IS NULL;
--
-- A non-zero answer means some code path changes item_routes without recording
-- its event — exactly the fault the new system exists to eliminate. Investigate
-- it; do not clear the table. The offending item ids are in that same table.
--
-- Also confirm the ledger is actually carrying data before you delete the old
-- system, or the dashboard is left with nothing at all:
--
--   SELECT count(*) FROM item_state_interval;   -- must be > 0
--   SELECT * FROM metrics_selfcheck();          -- every value 0 except
--                                               -- open_intervals, calendar_*,
--                                               -- ledger_bytes
--
-- AFTER this script, deploy the new application image. It requires schema
-- version 2, which the last statement here sets — an older image pointed at
-- this database will refuse to serve writes rather than fail halfway through
-- a test submission.
-- ===========================================================================

-- Migration B — THE DESTRUCTIVE ONE (plan §8 stage 7).
--
-- Drops the entire legacy metrics subsystem: 23 snapshot tables, the two
-- trigger-maintained live tables, the materialized view, the counter trigger and
-- its function — plus the dual-run drift scaffold, which has served its purpose.
--
-- THERE IS NO ROLLBACK. Re-deploying the previous application image does not
-- bring a dropped table back. The only recovery is a restore from backup.
--
-- THE GATE (§8 stage 7): apply this ONLY after a full week in which
-- metrics_selfcheck reported drift_open = 0 on every sample and Q3 matched
-- station_live_counters. The gate is enforced by the operator running
-- prod-deploy/db-server/scripts/9-apply-metrics-drop.ps1, which refuses to
-- proceed until it has verified the ledger is populated, the drift table is
-- empty, and the operator has confirmed the green week in writing.
--
-- Why CASCADE: verified there is no foreign key into any snapshot table, so
-- CASCADE removes nothing but the listed objects and their own indexes. It is
-- belt-and-braces against a hand-made constraint on the production volume that
-- the repo cannot see.
--
-- Idempotent throughout: the air-gap procedure re-runs files.

-- 1. The materialized view and the live-counter trigger machinery ------------
DROP MATERIALIZED VIEW IF EXISTS mv_station_stats;
DROP TRIGGER  IF EXISTS trg_update_station_counters ON item_routes;
DROP FUNCTION IF EXISTS update_station_counters();

-- 2. The legacy tables -------------------------------------------------------
-- 23 snapshot tables + station_live_counters + finished_item.
DROP TABLE IF EXISTS
  station_live_counters, station_hourly_snapshots, finished_item,
  system_snapshots, system_snapshots_daily, system_snapshots_monthly,
  kpi_snapshots, kpi_snapshots_monthly, kpi_snapshots_quarterly,
  customer_snapshots, customer_snapshots_daily, customer_snapshots_monthly,
  customer_snapshots_quarterly,
  shipment_snapshots, shipment_snapshots_monthly, shipment_snapshots_quarterly,
  station_snapshots, station_snapshots_monthly, station_snapshots_quarterly,
  item_type_snapshots, item_type_snapshots_monthly, item_type_snapshots_quarterly,
  status_distribution_snapshots, status_distribution_snapshots_monthly,
  status_distribution_snapshots_quarterly
CASCADE;

-- 3. The dual-run scaffold ---------------------------------------------------
-- metrics-guard: intentional-drop trg_metrics_drift, metrics_detect_drift, metrics_drift, metrics_drift_open
-- (declared for scripts/check-migration-safety.js: these three objects are
--  being RETIRED on purpose, not lost to a regenerated Prisma diff. The marker
--  covers this file only; every other guarded object still blocks here.)
-- metrics_drift existed to prove, over a release, that every item_routes writer
-- also emits its ledger event. Once that week is green the trigger is pure cost
-- on the hot path of every test submission. Ordered trigger -> function -> table
-- so nothing is dropped out from under a dependent.
DROP TRIGGER  IF EXISTS trg_metrics_drift ON item_routes;
DROP FUNCTION IF EXISTS metrics_detect_drift();
DROP TABLE    IF EXISTS metrics_drift;

-- 4. metrics_selfcheck without its drift row ---------------------------------
-- Same function, one check fewer (11, was 12). Replaced wholesale rather than
-- patched so the shipped text is the whole definition — the function is the
-- health contract and must never be reconstructed from a diff.
CREATE OR REPLACE FUNCTION metrics_selfcheck()
RETURNS TABLE(check_name text, value bigint, detail text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT 'open_intervals', count(*)::bigint, NULL::text
    FROM item_state_interval WHERE upper_inf(valid_range)
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
-- 5. Schema version ----------------------------------------------------------
-- The app's refuse-to-serve gate (src/app/lib/metrics/schema-gate.ts) compares
-- its required minimum against this. Bumping it here is what makes an old image
-- pointed at a post-drop database fail loudly at the first write instead of
-- calling a function that no longer exists.
UPDATE metrics_schema_version SET version = 2, applied_at = now() WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Bookkeeping.
-- ---------------------------------------------------------------------------
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '8831b32d646b0142acbf4d41a589a914f1cb7e7a47d7141bcafcdceb8d253a48', now(), '20260901000000_metrics_drop_snapshots', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260901000000_metrics_drop_snapshots');

-- ---------------------------------------------------------------------------
-- Verify. Expect: 0 legacy tables, schema version 2, 11 checks, no anomalies.
-- ---------------------------------------------------------------------------
SELECT count(*) AS legacy_tables_left
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND (table_name LIKE '%_snapshots%'
        OR table_name IN ('station_live_counters','finished_item','metrics_drift'));

SELECT version AS schema_version FROM metrics_schema_version WHERE id = 1;

SELECT * FROM metrics_selfcheck();
