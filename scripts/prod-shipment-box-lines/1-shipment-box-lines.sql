-- =============================================================================
-- מארזי המשלוח שייכים לשורה שלהם בתעודה; מועד הקבלה של המשלוח; אינדקסים
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261027100000_shipment_box_lines/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שורות התעודה המלאות כבר הותקנו (20261019130000_shipment_items_certificate_row
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה:
--      - items.shipment_item_id — עמודה חדשה: השורה במשלוח שהמארז הונפק בשבילה.
--        המארזים הקיימים מקושרים לשורות לפי אותו כלל מיקום שהקוד הקודם השתמש בו
--        (המארז ה-k מסוג = היחידה ה-k בשורות של הסוג), כך שאף פרט לא משתנה.
--        מארז מעבר לכמות המוצהרת נשאר בלי שורה.
--      - shipments.received_at — עמודה ריקה: מתי המשלוח נקלט במערכת (נרשמת מעכשיו
--        בשמירת משלוח חדש). משלוחים קיימים נשארים ריקים ונקראים לפי shipment_date.
--      - אינדקסים: items(shipment_item_id), items(shipment_id), ו-UPPER(TRIM(serial_no)).
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. בלי ההרצה, שמירה וקריאה של משלוחים
-- ומארזים מה-image החדש נכשלות. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-shipment-box-lines.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261027100000_shipment_box_lines') THEN
    RAISE EXCEPTION 'מיגרציית שיוך המארזים לשורות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261019130000_shipment_items_certificate_row') THEN
    RAISE EXCEPTION 'שורות התעודה המלאות עוד לא הותקנו (20261019130000_shipment_items_certificate_row חסרה) — להריץ קודם את scripts/prod-shipment-items-details. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- Shipment boxes belong to their certificate row; shipments record when they
-- were received; the item lookups by shipment and by serial get indexes.
--
-- WHY:
--   items.shipment_item_id — a pending box was matched to its shipment line
--     by position (the k-th box of a type = the k-th unit of that type's
--     lines). An edit recomputed the match, so deleting row 1 of two rows of
--     one type removed the newest box and handed row 2's details to the box
--     labelled for row 1. Now each box keeps the line it was minted for, and
--     an edit touches only the boxes of the lines it changes
--     (src/app/lib/packages/boxes.ts). ON DELETE SET NULL: a line removed
--     with its pending boxes leaves nothing pointing at it.
--   shipments.received_at — shipment_date is the certificate's own date
--     (locked when scanned); the moment the shipment entered the system is
--     what the dashboard's receipt-to-send time measures from. The app writes
--     it when it saves a new shipment (POST /api/shipments). No column
--     default: a row inserted any other way (an import script, a test
--     fixture of past shipments) would be stamped with the insert's time,
--     after its own send. Existing and such rows stay NULL (unknown) and
--     read as shipment_date.
--   idx_items_shipment_id — every shipment save, edit, label print and
--     delete reads the shipment's boxes; it was a full scan of items.
--   idx_items_serial_key — the serial rule (lib/packages/serials.ts) looks
--     items up by UPPER(TRIM(serial_no)) on every pause in typing. An
--     expression index Prisma cannot declare: guarded in
--     scripts/check-migration-safety.js and docs/PRISMA_UNMANAGED_OBJECTS.md.
--
-- The backfill links the boxes that exist by the same positional rule the
-- previous code used, so nothing a worker sees changes: per shipment and
-- package type, the k-th box by item_id takes the k-th declared unit by line
-- id. A box past the declared count stays NULL; the next sync of its
-- shipment adopts it into a line with room or (pending) removes it.
--
-- Additive: one nullable column on items, one on shipments (no default), three indexes.
-- The previous image keeps working after it (it never reads them). No
-- metrics_schema_version bump: the ledger reads neither column.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database; the backfill runs only when the column is new.
-- ============================================================================

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'items' AND column_name = 'shipment_item_id'
  ) THEN
    ALTER TABLE "items" ADD COLUMN "shipment_item_id" INTEGER;

    WITH units AS (
      SELECT si.id AS line_id, si.shipment_id, si.item_type_id,
             row_number() OVER (PARTITION BY si.shipment_id, si.item_type_id ORDER BY si.id, g) AS rn
      FROM shipment_items si
      CROSS JOIN LATERAL generate_series(1, GREATEST(si.quantity, 0)) AS g
      WHERE si.shipment_id IS NOT NULL AND si.item_type_id IS NOT NULL
    ), boxes AS (
      SELECT i.item_id, i.shipment_id, i.item_type_id,
             row_number() OVER (PARTITION BY i.shipment_id, i.item_type_id ORDER BY i.item_id) AS rn
      FROM items i
      JOIN item_types t ON t.item_type_id = i.item_type_id AND t.is_package
      WHERE i.package_id IS NULL
    )
    UPDATE items i
    SET shipment_item_id = u.line_id
    FROM boxes b
    JOIN units u ON u.shipment_id = b.shipment_id AND u.item_type_id = b.item_type_id AND u.rn = b.rn
    WHERE i.item_id = b.item_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_shipment_item_id_fkey') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_shipment_item_id_fkey"
      FOREIGN KEY ("shipment_item_id") REFERENCES "shipment_items"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'shipments' AND column_name = 'received_at'
  ) THEN
    ALTER TABLE "shipments" ADD COLUMN "received_at" TIMESTAMPTZ(6);
  END IF;
END
$mig$;

CREATE INDEX IF NOT EXISTS "idx_items_shipment_item_id" ON "items"("shipment_item_id");
CREATE INDEX IF NOT EXISTS "idx_items_shipment_id" ON "items"("shipment_id");
CREATE INDEX IF NOT EXISTS "idx_items_serial_key" ON "items" (UPPER(TRIM("serial_no"))) WHERE "serial_no" IS NOT NULL;

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'ccabb00faf40d9fadbfec37af252ac323409d14b05bff23402100a861dccb829', now(), '20261027100000_shipment_box_lines', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'מארזים מקושרים לשורה' AS בדיקה, count(*)::text AS תוצאה
  FROM items i JOIN item_types t ON t.item_type_id = i.item_type_id AND t.is_package
 WHERE i.package_id IS NULL AND i.shipment_item_id IS NOT NULL
UNION ALL
SELECT 'מארזים בלי שורה, ממתינים לקליטה (ייקלטו לשורה או יימחקו בעריכה הבאה)', count(*)::text
  FROM items i JOIN item_types t ON t.item_type_id = i.item_type_id AND t.is_package
 WHERE i.package_id IS NULL AND i.shipment_item_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM item_routes ir WHERE ir.item_id = i.item_id)
UNION ALL
SELECT 'מארז מקושר לשורה מסוג אחר (צריך 0)', count(*)::text
  FROM items i JOIN shipment_items si ON si.id = i.shipment_item_id
 WHERE si.item_type_id <> i.item_type_id
UNION ALL
SELECT 'אינדקסים חדשים', string_agg(indexname, ', ' ORDER BY indexname)
  FROM pg_indexes
 WHERE tablename = 'items' AND indexname IN ('idx_items_shipment_item_id', 'idx_items_shipment_id', 'idx_items_serial_key')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261027100000_shipment_box_lines';
