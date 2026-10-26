// Builds the production upgrade for popup templates (docs/popup-templates/PLAN.md, step 1.2):
//   1-popup-templates.sql  ← prisma/migrations/20261026120000_popup_templates
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-popup-templates/build-upgrade.mjs
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

const PREVIOUS = "20261021120000_reference_items_parent";
const m = readMigration("20261026120000_popup_templates");

write("1-popup-templates.sql", `-- =============================================================================
-- תבניות חלון לעמדות בדיקה (טבלאות התבנית, הגרסאות, ושיוך קבוצות צילום לרכיב)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: ${PREVIOUS} כבר רשומה, והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): station_popup_templates, station_popup_template_versions
--      (שתי טבלאות ריקות), ו-photo_types.test_station_type_id / component_id (ריקות).
--      שום נתון לא משתנה. בלי שורה בטבלת התבניות כל עמדה פותחת את החלון של היום.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-popup-templates.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית תבניות החלון כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${PREVIOUS}') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (${PREVIOUS}) חסרה — להריץ קודם את המיגרציות שלפניה. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'טבלאות חדשות' AS בדיקה, string_agg(table_name, ', ' ORDER BY table_name) AS תוצאה
  FROM information_schema.tables
 WHERE table_name IN ('station_popup_templates', 'station_popup_template_versions')
UNION ALL
SELECT 'עמודות חדשות ב-photo_types', string_agg(column_name, ', ' ORDER BY column_name)
  FROM information_schema.columns
 WHERE table_name = 'photo_types' AND column_name IN ('test_station_type_id', 'component_id')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);
