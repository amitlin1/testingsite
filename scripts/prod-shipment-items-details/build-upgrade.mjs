// Builds the production upgrades for the certificate row on shipment lines, one per migration, run in order:
//   1-shipment-items-certificate-details.sql  ← prisma/migrations/20261019120000_shipment_items_certificate_details
//   2-shipment-items-certificate-row.sql      ← prisma/migrations/20261019130000_shipment_items_certificate_row
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-shipment-items-details/build-upgrade.mjs
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

// ---- 1: makat's neighbours — model, manufacturer, manufacturer no. -----------------------------
const details = readMigration("20261019120000_shipment_items_certificate_details");

write("1-shipment-items-certificate-details.sql", `-- =============================================================================
-- פרטי שורת התעודה בשורות המשלוח (דגם, יצרן, מס׳ יצרן)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${details.name}/migration.sql
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${details.name}') THEN
    RAISE EXCEPTION 'מיגרציית פרטי שורת התעודה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${details.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(details)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-shipment_items' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_items' AND column_name IN ('model', 'manufacturer_name', 'manufacturer_no')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${details.name}';
`, details.checksum);

// ---- 2: the rest of the certificate row ---------------------------------------------------------
const row = readMigration("20261019130000_shipment_items_certificate_row");

write("2-shipment-items-certificate-row.sql", `-- =============================================================================
-- כל שורת התעודה בשורות המשלוח (מס"ד, סריאלי, גודל אצווה, כמות לבדיקה, הזמנה, השורה המלאה)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${row.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: 1-shipment-items-certificate-details.sql כבר הורץ
--      (${details.name} רשומה), והמיגרציה הזו עוד לא רשומה.
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${row.name}') THEN
    RAISE EXCEPTION 'מיגרציית שורת התעודה המלאה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${details.name}') THEN
    RAISE EXCEPTION 'פרטי שורת התעודה עוד לא הותקנו (${details.name} חסרה) — להריץ קודם את 1-shipment-items-certificate-details.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${row.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(row)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-shipment_items' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_items'
   AND column_name IN ('cert_row_no', 'serial_no', 'batch_size', 'qty_to_test', 'purchase_order', 'cert_row_raw')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${row.name}';
`, row.checksum);
