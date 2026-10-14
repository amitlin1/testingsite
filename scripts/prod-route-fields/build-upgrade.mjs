// Builds the production upgrades for "שדות בעמדות", one per migration, run in order:
//   1-route-station-fields.sql      ← prisma/migrations/20261013120000_route_station_fields
//   2-route-fields-apply-modes.sql  ← prisma/migrations/20261014120000_route_fields_apply_modes
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-route-fields/build-upgrade.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const migrationName = "20261013120000_route_station_fields";
const migration = readFileSync(path.join(repo, "prisma", "migrations", migrationName, "migration.sql"), "utf8");
const checksum = createHash("sha256").update(Buffer.from(migration, "utf8")).digest("hex");

const out = `-- =============================================================================
-- שדרוג DB הייצור לשדות בעמדות (route-fields) — הכול בפעולה אחת
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${migrationName}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: מודל המארזים כבר הותקן (metrics_schema_version >= 3,
--      המיגרציה 20260915120000_package_model רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): testing_routes.step_uids / fields_draft / draft_rev /
--      draft_updated_at / draft_updated_by / fields_version (+ מזהה יציב לכל שלב
--      קיים), הטבלאות route_field_versions, option_lists, field_sets, והעמודה
--      item_routes.fields_version. metrics_schema_version עולה ל-4.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ את הקובץ הזה לפני העלאת ה-image החדש. ה-image החדש דורש
-- גרסת סכמה 4 ובלעדיה כל כתיבה (שמירת תוצאה, קליטה, התחלת בדיקה) עונה 503.
-- ה-image הקודם ממשיך לעבוד גם אחרי ההרצה (הכול תוספות).
-- שום עמדה לא משתנה עד שמנהל מפרסם שדות; פריטים קיימים נשארים בחלון הקבוע.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-route-station-fields.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
DECLARE v int;
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${migrationName}') THEN
    RAISE EXCEPTION 'מיגרציית שדות בעמדות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260915120000_package_model') THEN
    RAISE EXCEPTION 'מודל המארזים עוד לא הותקן (20260915120000_package_model חסרה) — להריץ קודם את scripts/prod-package-model. לא בוצע כלום.';
  END IF;
  SELECT version INTO v FROM metrics_schema_version WHERE id = 1;
  IF v IS NULL OR v < 3 THEN
    RAISE EXCEPTION 'metrics_schema_version = % (נדרש 3 לפחות). לא בוצע כלום.', coalesce(v::text, 'חסר');
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${migration.trimEnd()}

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '${checksum}', now(), '${migrationName}', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'metrics_schema_version' AS בדיקה, version::text AS תוצאה FROM metrics_schema_version WHERE id = 1
UNION ALL
SELECT 'מסלולים עם שלבים', count(*)::text FROM testing_routes WHERE coalesce(cardinality(route_steps), 0) > 0
UNION ALL
SELECT 'מסלולים שקיבלו מזהה לכל שלב', count(*)::text FROM testing_routes
 WHERE coalesce(cardinality(route_steps), 0) > 0 AND cardinality(step_uids) = cardinality(route_steps)
UNION ALL
SELECT 'טבלאות חדשות', string_agg(table_name, ', ' ORDER BY table_name) FROM information_schema.tables
 WHERE table_name IN ('route_field_versions', 'option_lists', 'field_sets')
UNION ALL
SELECT 'item_routes.fields_version', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
 WHERE table_name = 'item_routes' AND column_name = 'fields_version') THEN 'קיימת' ELSE 'חסרה' END
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${migrationName}';
`;

const outPath = path.join(here, "1-route-station-fields.sql");
writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${checksum})`);

// ---- 2: the publish dialog's three scopes (20261014120000_route_fields_apply_modes) ----------------
const modesName = "20261014120000_route_fields_apply_modes";
const modes = readFileSync(path.join(repo, "prisma", "migrations", modesName, "migration.sql"), "utf8");
const modesChecksum = createHash("sha256").update(Buffer.from(modes, "utf8")).digest("hex");

const out2 = `-- =============================================================================
-- שדות בעמדות — שלוש אפשרויות "על מי תחול הגרסה" בחלון הפרסום
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${modesName}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שדות בעמדות כבר הותקנו (1-route-station-fields.sql הורץ,
--      ${migrationName} רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: האילוץ route_field_versions_apply_chk מתרחב — apply_mode יכול
--      להיות גם 'not_started' (פריטים שעוד לא התחילו את המסלול, ברירת המחדל) ו-'all'
--      (כל הפריטים, גם בבדיקה). שום נתון לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. בלי הקובץ הזה, פרסום מה-image החדש
-- נכשל (500) — שאר המערכת עובדת. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-route-fields-apply-modes.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${modesName}') THEN
    RAISE EXCEPTION 'מיגרציית אפשרויות הפרסום כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${migrationName}') THEN
    RAISE EXCEPTION 'שדות בעמדות עוד לא הותקנו (${migrationName} חסרה) — להריץ קודם את 1-route-station-fields.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${modes.trimEnd()}

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '${modesChecksum}', now(), '${modesName}', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'האילוץ על apply_mode' AS בדיקה, pg_get_constraintdef(oid) AS תוצאה FROM pg_constraint
 WHERE conname = 'route_field_versions_apply_chk'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${modesName}';
`;

const outPath2 = path.join(here, "2-route-fields-apply-modes.sql");
writeFileSync(outPath2, out2.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath2)} (${out2.split("\n").length} lines, migration sha256 ${modesChecksum})`);
