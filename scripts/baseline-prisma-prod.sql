-- ===========================================================================
-- Prisma migrations baseline — one-time setup for a production DB that was
-- populated by running migration SQL files manually (not via Prisma).
--
-- Run this ONCE in DBeaver (or psql) connected to the production database.
-- After this, `npm run db:deploy` will apply only NEW migrations cleanly.
--
-- Idempotent: re-running won't duplicate rows (each INSERT checks NOT EXISTS).
-- Checksums match what Prisma computed against the local dev DB on 2026-05-31.
-- ===========================================================================

-- 1. Create the bookkeeping table Prisma uses to track applied migrations.
--    Schema mirrors the one Prisma 7 creates automatically on first migrate.
CREATE TABLE IF NOT EXISTS public._prisma_migrations (
    id                  VARCHAR(36)  PRIMARY KEY,
    checksum            VARCHAR(64)  NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    applied_steps_count INTEGER      NOT NULL DEFAULT 0
);

-- 2. Mark each existing migration as already applied.
--    Each INSERT is guarded by NOT EXISTS so the script is safe to re-run.

INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '7e93286860212b2e723e6353b02c8036833ad9e6ee82475b9bf9a9f4ec3c2dcc',
       now(), '0_init', now(), 0
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                  WHERE migration_name = '0_init');

INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       'b86a2309bec8883b5b8745215af4811874a3331a62d5fa9b92f3990d5db25542',
       now(), '20260217140614_add_poc_and_stokekeeper', now(), 0
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                  WHERE migration_name = '20260217140614_add_poc_and_stokekeeper');

INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       'e51d7ba7fcc2abcdcdecdeeb42f45873af7774145d68e30c079f5e7a29ccbfa3',
       now(), '20260218000000_dashboard_optimization', now(), 0
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                  WHERE migration_name = '20260218000000_dashboard_optimization');

INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       'fd9ca147ba9cc1d41e267fd83031d0d5fcbee6caaec8e7a5af2e08f37b9c3611',
       now(), '20260224085257_update_database_structure', now(), 0
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                  WHERE migration_name = '20260224085257_update_database_structure');

INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '5f5c338d53746050435f5146bcb086b817508dc44a650a67933f9e8a0cd8f4da',
       now(), '20260528000000_add_file_objects', now(), 1
WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations
                  WHERE migration_name = '20260528000000_add_file_objects');

-- 3. Verify. Expected: 5 rows, every "applied" = true.
SELECT migration_name,
       finished_at IS NOT NULL  AS applied,
       applied_steps_count,
       checksum
FROM public._prisma_migrations
ORDER BY migration_name;
