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
