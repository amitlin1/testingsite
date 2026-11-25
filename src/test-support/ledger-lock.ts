/**
 * The Postgres advisory lock an integration suite holds for the life of its file when it TRUNCATEs
 * the metrics ledger, work_calendar_version or the lookup tables (the shared harness does), or keeps
 * rows in those tables that such a truncate would wipe. `node --test` runs test FILES in parallel;
 * without it one suite's fixture wipes another's tables mid-test. Session-level: take it on a
 * dedicated pooled client, release it in `after`.
 */
export const LEDGER_TRUNCATE_LOCK = 526050825;
