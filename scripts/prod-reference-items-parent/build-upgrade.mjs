// Builds the production upgrade for package references (ייחוס מארז):
//   1-reference-items-parent.sql  ← prisma/migrations/20261021120000_reference_items_parent
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-reference-items-parent/build-upgrade.mjs
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

const m = readMigration("20261021120000_reference_items_parent");

write("1-reference-items-parent.sql", `-- =============================================================================
-- ייחוס מארז: פריט ייחוס של סוג מארז מחזיק פריט ייחוס לכל שורה בתכולה
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: טבלת פריטי הייחוס קיימת (20260709084717 רשומה), והמיגרציה
--      הזו עוד לא רשומה.
--   ב. המיגרציה (מבנה בלבד): עמודה חדשה reference_items.parent_reference_id —
--      ריקה בפריט ייחוס רגיל ובייחוס מארז, ומלאה בפריט ייחוס שבתוך ייחוס מארז.
--      מפתח זר לעצמה (מחיקת ייחוס מארז מוחקת את הפריטים שבו), ואינדקס ייחודי:
--      פריט ייחוס אחד לכל סוג פריט בתוך ייחוס מארז. אין שינוי בנתונים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: אפשר להריץ בכל זמן לפני העלאת ה-image החדש — ה-image הקודם לא
-- קורא את העמודה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-reference-items-parent.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית ייחוס המארז כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260709084717_add_reference_items') THEN
    RAISE EXCEPTION 'טבלת פריטי הייחוס עוד לא הותקנה (20260709084717_add_reference_items חסרה). לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודת parent_reference_id' AS בדיקה, count(*)::text AS תוצאה
  FROM information_schema.columns WHERE table_name = 'reference_items' AND column_name = 'parent_reference_id'
UNION ALL
SELECT 'מפתח זר fk_reference_items_parent', count(*)::text FROM pg_constraint WHERE conname = 'fk_reference_items_parent'
UNION ALL
SELECT 'אינדקס reference_items_parent_type_uq', count(*)::text FROM pg_indexes WHERE indexname = 'reference_items_parent_type_uq'
UNION ALL
SELECT 'פריטי ייחוס בתוך ייחוסי מארז (צריך להיות 0)', count(*)::text FROM reference_items WHERE parent_reference_id IS NOT NULL
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);
