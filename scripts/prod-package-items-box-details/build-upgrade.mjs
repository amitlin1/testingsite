// Builds the production upgrade for package items taking their box's details:
//   1-package-items-box-details.sql  ← prisma/migrations/20261020150000_package_items_box_details
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-package-items-box-details/build-upgrade.mjs
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

const m = readMigration("20261020150000_package_items_box_details");

write("1-package-items-box-details.sql", `-- =============================================================================
-- פריטים במארז מקבלים את פרטי המארז (שורת התעודה מהמשלוח) במקום פרטי התבנית
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: מודל המארזים מותקן (20260915120000_package_model רשומה),
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (נתונים בלבד): פריטים של מארז שעדיין בעמדת הפתיחה, שעוד לא הוזן
--      להם סריאלי, מקבלים את המק״ט / הדגם / היצרן / מספר היצרן של המארז. פריט
--      שכבר הוזן לו סריאלי, ומארז בלי פרטים משלו — לא משתנים. אין שינוי בטבלאות.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ אחרי העלאת ה-image החדש — ה-image הקודם עדיין נותן לפריטים
-- בקליטה את פרטי התבנית, וקליטה שתיעשה אחרי ההרצה ועד ההחלפה לא תתוקן.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-package-items-box-details.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית פרטי המארז לפריטים כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
-- פריטים בעמדת הפתיחה, בלי סריאלי, שפרטיהם עדיין שונים מפרטי המארז — צריך להיות 0.
SELECT 'פריטים שנשארו עם פרטים שונים מהמארז' AS בדיקה, count(*)::text AS תוצאה
  FROM items i
  JOIN items b ON b.item_id = i.package_id AND b.package_id IS NULL
  JOIN item_routes r ON r.item_id = b.item_id AND r.current_route_step = 1 AND NOT r.is_finished
 WHERE NULLIF(TRIM(COALESCE(i.serial_no, '')), '') IS NULL
   AND COALESCE(NULLIF(TRIM(b.makat), ''), NULLIF(TRIM(b.model), ''), NULLIF(TRIM(b.manufacturer_name), ''), NULLIF(TRIM(b.manufacturer_no), '')) IS NOT NULL
   AND (i.makat, i.model, i.manufacturer_name, i.manufacturer_no) IS DISTINCT FROM (b.makat, b.model, b.manufacturer_name, b.manufacturer_no)
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);
