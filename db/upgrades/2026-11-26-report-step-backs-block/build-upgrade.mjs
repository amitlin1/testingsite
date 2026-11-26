// Builds the production upgrade that adds the "החזרות לבדיקה חוזרת" block to the report templates:
//   1-report-step-backs-block.sql  ← prisma/migrations/20261126130000_report_step_backs_block
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node db/upgrades/2026-11-26-report-step-backs-block/build-upgrade.mjs
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

const m = readMigration("20261126130000_report_step_backs_block");
const prev = "20261126120000_drop_sent_shipment_code";

const out = `-- =============================================================================
-- בלוק "החזרות לבדיקה חוזרת" בתבניות דוח הפריט
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (${prev}) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: בתבנית הכללית ובכל תבנית של מסלול נוסף בלוק "החזרות לבדיקה חוזרת"
--      (מתי, מאיזה שלב לאיזה, מי החזיר והסיבה), מיד אחרי טבלת התוצאות / פירוט השלבים;
--      בלי אחד מהם — לפני החתימה הראשונה, ואם אין — בסוף. תבנית ריקה נשארת ריקה.
--      דוחות שכבר נחתמו סופית הם PDF קפוא ולא משתנים. נתונים בלבד, בלי שינוי סכמה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש, אחרי 2026-11-26-drop-sent-shipment-code.
-- ה-image הקודם מדלג על סוג בלוק שהוא לא מכיר, כך שההרצה לא משנה שום דבר שהוא מדפיס.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-step-backs-block.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'בלוק החזרות לבדיקה חוזרת כבר הוחל. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${prev}') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (${prev}) חסרה — להריץ קודם את db/upgrades/2026-11-26-drop-sent-shipment-code. לא בוצע כלום.';
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
SELECT 'תבנית כללית עם בלוק החזרות (צריך 1 אם יש בה תוכן)' AS בדיקה, count(*)::text AS תוצאה
  FROM report_general_template
 WHERE "template"::jsonb->'content' @> '[{"type": "StepBacks"}]'::jsonb
UNION ALL
SELECT 'תבניות מסלול עם תוכן ובלי בלוק החזרות (צריך 0)', count(*)::text
  FROM report_templates
 WHERE jsonb_typeof("template"::jsonb->'content') = 'array'
   AND jsonb_array_length("template"::jsonb->'content') > 0
   AND NOT ("template"::jsonb->'content' @> '[{"type": "StepBacks"}]'::jsonb)
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`;

const outPath = path.join(here, "1-report-step-backs-block.sql");
writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${m.checksum})`);
