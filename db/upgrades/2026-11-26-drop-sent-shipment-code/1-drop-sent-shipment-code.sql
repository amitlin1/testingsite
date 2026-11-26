-- =============================================================================
-- מחיקת "קוד משלוח יוצא" מהחזרות המשלוחים
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261126120000_drop_sent_shipment_code/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (20261119120000_report_closing_signer_role) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: העמודה shipment_history.sent_shipment_code נמחקת.
--      ⚠ הרסני: הקודים שהוקלדו בהחזרות קודמות נמחקים איתה ואין דרך לשחזר אותם בלי גיבוי.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ יחד עם העלאת ה-image החדש. ה-image הקודם כותב את העמודה בכל
-- החזרת משלוח, כך שבין ההרצה להעלאה החזרות נכשלות. ה-image החדש לא כותב אותה, אבל
-- היא NOT NULL — לכן גם הוא לא יכול להחזיר משלוח לפני ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-drop-sent-shipment-code.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126120000_drop_sent_shipment_code') THEN
    RAISE EXCEPTION 'מחיקת קוד המשלוח היוצא כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261119120000_report_closing_signer_role') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (20261119120000_report_closing_signer_role) חסרה — להריץ קודם את db/upgrades/2026-11-19-report-closing-role. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- The outgoing shipment code is gone: a return (shipment_history) is known by
-- its shipment, date, sender and signature only. The return form no longer asks
-- for it, and the history groups one send's lines by its signature file.
--
-- DESTRUCTIVE: the codes already typed into past returns are deleted with the
-- column. The previous image writes the column (NOT NULL) on every return, so
-- run this together with the new image — between the two, returns fail.
-- Idempotent.
-- ============================================================================

ALTER TABLE "shipment_history" DROP COLUMN IF EXISTS "sent_shipment_code";

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '049f2989a68cfc6d35624ffbade213387e6b54a958d6b1601269d40cb6a45c78', now(), '20261126120000_drop_sent_shipment_code', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודת קוד משלוח יוצא (צריך 0)' AS בדיקה, count(*)::text AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_history' AND column_name = 'sent_shipment_code'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261126120000_drop_sent_shipment_code';
