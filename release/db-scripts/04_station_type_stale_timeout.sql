-- STEP 4 of 5  —  SAFE, additive.
--
-- One column on test_stations_type: how many minutes a test at this type of
-- station may sit with no result before the cron releases it and frees the
-- bench. Default 30, which is what the code used to hardcode for every station.
--
-- 0 means NEVER auto-release — that is what a research bench or a long
-- environmental chamber wants. Edit the values in Settings > station types
-- once the new app image is running.

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

-- ---------------------------------------------------------------------------
-- Bookkeeping: record the migration as applied, so a later `prisma migrate
-- deploy` does not try to run it again. Same shape prisma itself writes.
-- ---------------------------------------------------------------------------
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '35b07e3b670c1b4c550b72b7fdf3df70e738ccd108e3719626f2558dfe08f3fe', now(), '20260828090000_station_type_stale_timeout', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260828090000_station_type_stale_timeout');
