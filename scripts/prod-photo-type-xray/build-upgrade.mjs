// Builds the production upgrade for the X-ray photo type ("צילום שיקוף"):
//   1-photo-type-xray.sql  ← prisma/migrations/20261020140000_photo_type_xray
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-photo-type-xray/build-upgrade.mjs
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

const m = readMigration("20261020140000_photo_type_xray");

write("1-photo-type-xray.sql", `-- =============================================================================
-- סוג תמונה "צילום שיקוף" (במקום "צילום הרכבה" שכובה)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית צילום השיקוף כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260719120000_add_disassembly_assembly_photo_types') THEN
    RAISE EXCEPTION 'סוגי התמונות של הפירוק וההרכבה עוד לא הותקנו (20260719120000 חסרה). לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'צילום שיקוף' AS בדיקה, photo_type_desc || ' · ' || CASE WHEN is_active THEN 'פעיל' ELSE 'כבוי' END AS תוצאה
  FROM photo_types WHERE code = 'assembly'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);
