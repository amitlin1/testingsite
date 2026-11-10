// Builds the production upgrade for the report's closing signature (docs/ITEM_REPORTS.md):
//   1-report-closing-signature.sql          ← prisma/migrations/20261110120000_report_closing_signature
//   2-report-templates-both-signatures.sql  ← prisma/migrations/20261110130000_report_templates_both_signatures
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node scripts/prod-report-closing-signature/build-upgrade.mjs
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

const m = readMigration("20261110120000_report_closing_signature");

write("1-report-closing-signature.sql", `-- =============================================================================
-- שתי חתימות על דוח פריט: חתימה בסגירת המארז + חתימה סופית
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: התבנית הכללית כבר הותקנה (20261104120000_report_general_template
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): שש עמודות חדשות ב-item_reports לחתימה שניתנת
--      בסגירת המארז (closing_signature_key, closing_signed_by, ...). כולן ריקות.
--      שום נתון קיים לא משתנה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי
-- ההרצה. גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-closing-signature.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית החתימה בסגירה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261104120000_report_general_template') THEN
    RAISE EXCEPTION 'התבנית הכללית עוד לא הותקנה (20261104120000_report_general_template חסרה) — להריץ קודם את scripts/prod-report-general-template. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות החתימה בסגירה' AS בדיקה, count(*)::text || ' מתוך 6' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name LIKE 'closing\\_%'
UNION ALL
SELECT 'דוחות קיימים (לא השתנו)', count(*)::text FROM item_reports
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`, m.checksum);

const t = readMigration("20261110130000_report_templates_both_signatures");

write("2-report-templates-both-signatures.sql", `-- =============================================================================
-- כל תבנית דוח מבקשת את שתי החתימות: חתימה בסגירת המארז + חתימה סופית
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${t.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: 1-report-closing-signature.sql כבר הורץ (${m.name}
--      רשומה), והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (נתונים בלבד): בתבנית הכללית ובכל תבנית של מסלול שאין בה בלוק
--      "החותם בסגירת המארז" — נוסף בלוק כזה (שורה "בודק") מעל בלוק החתימה הסופית,
--      ולשורת החתימה הסופית נוסף תא "מאשר סופי". תבנית בלי חתימה סופית מקבלת
--      את שתי השורות בסוף. דוחות שכבר ננעלו לא משתנים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: אחרי 1-report-closing-signature.sql, לפני העלאת ה-image החדש.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-report-templates-both-signatures.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${t.name}') THEN
    RAISE EXCEPTION 'מיגרציית שתי החתימות בתבניות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'עמודות החתימה בסגירה עוד לא הותקנו (${m.name} חסרה) — להריץ קודם את 1-report-closing-signature.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${t.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(t)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'התבנית הכללית' AS תבנית,
       (SELECT count(*) FROM jsonb_array_elements(template->'content') n WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing')::text || ' בסגירה, ' ||
       (SELECT count(*) FROM jsonb_array_elements(template->'content') n WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'final')::text || ' סופית' AS חתימות
  FROM report_general_template
UNION ALL
SELECT 'מסלול ' || test_route_id,
       (SELECT count(*) FROM jsonb_array_elements(template->'content') n WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'closing')::text || ' בסגירה, ' ||
       (SELECT count(*) FROM jsonb_array_elements(template->'content') n WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = 'final')::text || ' סופית'
  FROM report_templates
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${t.name}';
`, t.checksum);
