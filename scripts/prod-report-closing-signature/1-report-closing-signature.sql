-- =============================================================================
-- שתי חתימות על דוח פריט: חתימה בסגירת המארז + חתימה סופית
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261110120000_report_closing_signature/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: התבנית הכללית כבר הותקנה (20261104120000_report_general_template
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): שש עמודות חדשות ב-item_reports לחתימה שניתנת
--      בסגירת המארז (closing_signature_key, closing_signed_by, ...). כולן ריקות.
--      שום נתון קיים לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי
-- ההרצה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-closing-signature.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261110120000_report_closing_signature') THEN
    RAISE EXCEPTION 'מיגרציית החתימה בסגירה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261104120000_report_general_template') THEN
    RAISE EXCEPTION 'התבנית הכללית עוד לא הותקנה (20261104120000_report_general_template חסרה) — להריץ קודם את scripts/prod-report-general-template. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- Two signatures on an item report (docs/ITEM_REPORTS.md):
--
--   the closing signature  given at the kit's closing, in the closing template's
--                          "חתימה על הדוחות" step, before "סגור מארז". It is
--                          printed in the report but does not lock it.
--   the final signature    the approver's, on the item's history page — the
--                          existing signature_* columns. It locks the report.
--
-- The closing signature gets columns of its own on item_reports, in the shape of
-- the final one's, and is valid only for the finish it was given for
-- (closing_signed_finished_at = item_routes.finished_at), so reopening an item
-- needs no cleanup here either.
--
-- Additive only: six nullable columns, nothing existing changes. The previous
-- image never reads them, so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read them.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signature_key"      VARCHAR(1024);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by"          VARCHAR(255);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by_name"     TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by_number"   VARCHAR(64);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_at"          TIMESTAMPTZ(6);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_finished_at" TIMESTAMP(6);

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'a4e7156ac578bad811cbff444cefa530e63dddf5c84a1b850fae396ec001b8ff', now(), '20261110120000_report_closing_signature', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות החתימה בסגירה' AS בדיקה, count(*)::text || ' מתוך 6' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name LIKE 'closing\_%'
UNION ALL
SELECT 'דוחות קיימים (לא השתנו)', count(*)::text FROM item_reports
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261110120000_report_closing_signature';
