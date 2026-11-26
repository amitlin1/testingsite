// Builds the production upgrade for the closing signer's role (docs/features/ITEM_REPORTS.md):
//   1-report-closing-role.sql  ← prisma/migrations/20261119120000_report_closing_signer_role
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node db/upgrades/2026-11-19-report-closing-role/build-upgrade.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");

const readMigration = (name) => {
  const sql = readFileSync(path.join(repo, "prisma", "migrations", name, "migration.sql"), "utf8");
  return { name, sql, checksum: createHash("sha256").update(Buffer.from(sql, "utf8")).digest("hex") };
};

const m = readMigration("20261119120000_report_closing_signer_role");
const prev = "20261110130000_report_templates_both_signatures";

const closingRoleCells = (cell) =>
  `(SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n, jsonb_array_elements(n->'props'->'cells') c
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing' AND c->>'kind' = '${cell}')`;

const out = `-- =============================================================================
-- תפקיד החותם בסגירת המארז: "בודק" או "מנהל" לפי מי שחתם
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: שתי החתימות כבר הותקנו (${prev}
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה:
--      - עמודה חדשה ב-item_reports: closing_signed_by_role (ריקה בכל השורות הקיימות).
--      - בתבנית הכללית ובכל תבנית של מסלול: בשורת החתימה בסגירה, תא "תפקיד" שכתוב בו
--        בדיוק "בודק" הופך לתא "תפקיד החותם". תא שמישהו כתב בו טקסט אחר לא משתנה.
--        שורת החתימה הסופית ("מאשר סופי") לא משתנה. דוחות שכבר ננעלו לא משתנים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ ממש לפני העלאת ה-image החדש. ה-image הקודם לא מכיר את התא החדש
-- ומדפיס אותו ריק, כך שבין ההרצה להעלאה שורת הבודק בטיוטה תופיע בלי תפקיד.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-closing-role.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית תפקיד החותם בסגירה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${prev}') THEN
    RAISE EXCEPTION 'שתי החתימות עוד לא הותקנו (${prev} חסרה) — להריץ קודם את db/upgrades/2026-11-10-report-closing-signature. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '${m.checksum}', now(), '${m.name}', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודת תפקיד החותם' AS בדיקה, count(*)::text || ' מתוך 1' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name = 'closing_signed_by_role'
UNION ALL
SELECT 'התבנית הכללית: תאי "תפקיד החותם" בשורת הסגירה', ${closingRoleCells("role")}::text
  FROM report_general_template
UNION ALL
SELECT 'מסלול ' || test_route_id || ': תאי "תפקיד החותם" בשורת הסגירה', ${closingRoleCells("role")}::text
  FROM report_templates
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`;

const outPath = path.join(here, "1-report-closing-role.sql");
writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${m.checksum})`);
