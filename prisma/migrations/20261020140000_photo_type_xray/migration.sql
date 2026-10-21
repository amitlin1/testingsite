-- ============================================================================
-- photo_types: the 'assembly' photo type back on, named "צילום שיקוף".
--
-- WHY: the assembly station it was added for (20260719120000) is gone, and the
-- type was switched off by hand in the database (no screen does that), so the
-- reference-items screen stopped offering it. It returns for X-ray photos,
-- under a new name. The code stays 'assembly': it is the stable key that
-- captures and the station registry (src/app/testing/tests-popups/mainPopUp.ts)
-- address it by.
--
-- Data only: one row, no schema change. No metrics_schema_version bump: the
-- ledger does not read photo types.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database. A database without the row gets it.
-- ============================================================================

INSERT INTO "photo_types" ("code", "photo_type_desc", "sort_order", "is_active")
VALUES ('assembly', 'צילום שיקוף', 4, true)
ON CONFLICT ("code") DO UPDATE
    SET "photo_type_desc" = EXCLUDED."photo_type_desc",
        "is_active"       = true;
