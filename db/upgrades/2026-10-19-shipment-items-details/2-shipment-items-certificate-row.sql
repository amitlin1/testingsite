-- =============================================================================
-- כל שורת התעודה בשורות המשלוח (מס"ד, סריאלי, גודל אצווה, כמות לבדיקה, הזמנה, השורה המלאה)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261019130000_shipment_items_certificate_row/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: 1-shipment-items-certificate-details.sql כבר הורץ
--      (20261019120000_shipment_items_certificate_details רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): shipment_items.cert_row_no / serial_no / batch_size /
--      qty_to_test / purchase_order / cert_row_raw — שש עמודות ריקות. שום נתון לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ אחרי 1-shipment-items-certificate-details.sql ולפני העלאת
-- ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-shipment-items-certificate-row.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261019130000_shipment_items_certificate_row') THEN
    RAISE EXCEPTION 'מיגרציית שורת התעודה המלאה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261019120000_shipment_items_certificate_details') THEN
    RAISE EXCEPTION 'פרטי שורת התעודה עוד לא הותקנו (20261019120000_shipment_items_certificate_details חסרה) — להריץ קודם את 1-shipment-items-certificate-details.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- shipment_items: the rest of the certificate row a line was scanned from.
--
-- WHY: a line scanned from the certificate's equipment table kept only the
-- makat, model, manufacturer and manufacturer number
-- (20261019120000_shipment_items_certificate_details). The row has more:
--   rowNum|manufacturerNo|manufacturerName|version|idfMakat|serialNum|batchSize|qtyToTest|orderNum
-- and all of it is kept now (src/app/lib/itemQrParser.ts):
--   cert_row_no     the row's number on the certificate (מס"ד)
--   serial_no       the row's serial — a row with one is a single unit
--   batch_size      גודל אצווה, as printed
--   qty_to_test     how many of the row come to be tested
--   purchase_order  the order number
--   cert_row_raw    the row exactly as in the barcode, whatever it holds
-- A line typed by hand leaves them NULL.
--
-- Additive only: six nullable columns, no data moves. The previous image keeps
-- working after it (it never reads them), so this runs any time before the
-- new image. No metrics_schema_version bump: the ledger does not read
-- shipment lines.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "cert_row_no" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "serial_no" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "batch_size" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "qty_to_test" INTEGER;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "purchase_order" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "cert_row_raw" TEXT;

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '1686dae337431ea4fde4216f61ae38b74533ebb23fbe9c86ccada562de1ccc2c', now(), '20261019130000_shipment_items_certificate_row', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-shipment_items' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_items'
   AND column_name IN ('cert_row_no', 'serial_no', 'batch_size', 'qty_to_test', 'purchase_order', 'cert_row_raw')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261019130000_shipment_items_certificate_row';
