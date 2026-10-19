-- =============================================================================
-- פרטי שורת התעודה בשורות המשלוח (דגם, יצרן, מס׳ יצרן)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261019120000_shipment_items_certificate_details/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: מודל המארזים כבר הותקן (20260915120000_package_model
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): shipment_items.model / manufacturer_name /
--      manufacturer_no — שלוש עמודות ריקות. שום נתון לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש, ואחריו את 2-shipment-items-certificate-row.sql.
-- בלי שניהם, שמירה וקריאה של משלוחים מה-image החדש נכשלות. ה-image הקודם ממשיך
-- לעבוד גם אחרי ההרצה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-shipment-items-certificate-details.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261019120000_shipment_items_certificate_details') THEN
    RAISE EXCEPTION 'מיגרציית פרטי שורת התעודה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- shipment_items: the certificate row's model, manufacturer and manufacturer
-- number, next to the makat it already keeps.
--
-- WHY: a box is minted from its shipment line (lib/packages/boxes.ts) and its
-- items take their details from the box at intake, so the opening station no
-- longer types them. The line kept only the makat; the rest of the row
-- scanned from the certificate was dropped on save, so a box had no model or
-- manufacturer to pass on.
--
-- Additive only: three nullable columns, no data moves. The previous image
-- keeps working after it (it never reads them), so this runs any time before
-- the new image. No metrics_schema_version bump: the ledger does not read
-- shipment lines.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "manufacturer_name" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "manufacturer_no" TEXT;

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'c6d71df1ded9509f560e8b0e0853c51088cc4f8660cd4c8c73c2c791a1b9b809', now(), '20261019120000_shipment_items_certificate_details', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-shipment_items' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_items' AND column_name IN ('model', 'manufacturer_name', 'manufacturer_no')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261019120000_shipment_items_certificate_details';
