-- =============================================================================
-- סוג תמונה "צילום שיקוף" (במקום "צילום הרכבה" שכובה)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261020140000_photo_type_xray/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: טבלת סוגי התמונות קיימת (20260719120000 רשומה), והמיגרציה
--      הזו עוד לא רשומה.
--   ב. המיגרציה (נתונים בלבד): סוג התמונה 'assembly' חוזר לפעיל ושמו "צילום שיקוף".
--      הקוד 'assembly' לא משתנה. אין שינוי בטבלאות.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: אפשר להריץ בכל זמן — ה-image הקודם והחדש עובדים איתה. גרסת הסכמה
-- (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-photo-type-xray.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261020140000_photo_type_xray') THEN
    RAISE EXCEPTION 'מיגרציית צילום השיקוף כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260719120000_add_disassembly_assembly_photo_types') THEN
    RAISE EXCEPTION 'סוגי התמונות של הפירוק וההרכבה עוד לא הותקנו (20260719120000 חסרה). לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
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

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '15c9b8af45c2cb8f25368c5c087a050da2fcaa19494ffa9e13cdc1ad2ff2c501', now(), '20261020140000_photo_type_xray', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'צילום שיקוף' AS בדיקה, photo_type_desc || ' · ' || CASE WHEN is_active THEN 'פעיל' ELSE 'כבוי' END AS תוצאה
  FROM photo_types WHERE code = 'assembly'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261020140000_photo_type_xray';
