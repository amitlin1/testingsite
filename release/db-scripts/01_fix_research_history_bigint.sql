-- STEP 1 of 5  —  SAFE, run any time
--
-- research_history.item_id was int4 while item ids are bigint. Item ids are
-- built by concatenating customer + date + counter, so the 10th item of a day
-- for a three-digit customer already overflows and the INSERT dies with 22003.
-- One ALTER. Seconds on any realistic table size.

-- research_history.item_id was int4 while items.item_id / item_routes.item_id are
-- bigint. Item ids are built by string-concatenation (customer/date/counter), so
-- the 10th item of a day for a three-digit customer already exceeds 2^31-1 and
-- the INSERT in /api/testing/results aborts with 22003 (numeric_value_out_of_range).
ALTER TABLE "research_history" ALTER COLUMN "item_id" TYPE BIGINT;

-- ---------------------------------------------------------------------------
-- Bookkeeping: record the migration as applied, so a later `prisma migrate
-- deploy` does not try to run it again. Same shape prisma itself writes.
-- ---------------------------------------------------------------------------
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, 'c85848d5798bed950db32c64d623530f2468d200dd233f83951be948d6ce5e80', now(), '20260824090000_research_history_item_id_bigint', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260824090000_research_history_item_id_bigint');
