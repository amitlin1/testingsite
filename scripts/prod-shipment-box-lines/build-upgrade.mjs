// Builds the production upgrade for shipment boxes linked to their lines:
//   1-shipment-box-lines.sql  ← prisma/migrations/20261027100000_shipment_box_lines
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-shipment-box-lines/build-upgrade.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

const readMigration = (name) => {
  const sql = readFileSync(path.join(repo, "prisma", "migrations", name, "migration.sql"), "utf8");
  return { name, sql, checksum: createHash("sha256").update(Buffer.from(sql, "utf8")).digest("hex") };
};

const write = (file, out, checksum) => {
  const outPath = path.join(here, file);
  writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
  console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${checksum})`);
};

const register = (m) => `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '${m.checksum}', now(), '${m.name}', NULL, NULL, now(), 1);`;

const PREVIOUS = "20261019130000_shipment_items_certificate_row";
const m = readMigration("20261027100000_shipment_box_lines");

write("1-shipment-box-lines.sql", `-- =============================================================================
-- מארזי המשלוח שייכים לשורה שלהם בתעודה; מועד הקבלה של המשלוח; אינדקסים
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שורות התעודה המלאות כבר הותקנו (${PREVIOUS}
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית שיוך המארזים לשורות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${PREVIOUS}') THEN
    RAISE EXCEPTION 'שורות התעודה המלאות עוד לא הותקנו (${PREVIOUS} חסרה) — להריץ קודם את scripts/prod-shipment-items-details. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

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
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);
