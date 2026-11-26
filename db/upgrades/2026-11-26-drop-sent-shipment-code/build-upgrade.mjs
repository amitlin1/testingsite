// Builds the production upgrade that drops the outgoing shipment code:
//   1-drop-sent-shipment-code.sql  ← prisma/migrations/20261126120000_drop_sent_shipment_code
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node db/upgrades/2026-11-26-drop-sent-shipment-code/build-upgrade.mjs
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

const m = readMigration("20261126120000_drop_sent_shipment_code");
const prev = "20261119120000_report_closing_signer_role";

const out = `-- =============================================================================
-- מחיקת "קוד משלוח יוצא" מהחזרות המשלוחים
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (${prev}) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: העמודה shipment_history.sent_shipment_code נמחקת.
--      ⚠ הרסני: הקודים שהוקלדו בהחזרות קודמות נמחקים איתה ואין דרך לשחזר אותם בלי גיבוי.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ יחד עם העלאת ה-image החדש. ה-image הקודם כותב את העמודה בכל
-- החזרת משלוח, כך שבין ההרצה להעלאה החזרות נכשלות. ה-image החדש לא כותב אותה, אבל
-- היא NOT NULL — לכן גם הוא לא יכול להחזיר משלוח לפני ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-drop-sent-shipment-code.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מחיקת קוד המשלוח היוצא כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${prev}') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (${prev}) חסרה — להריץ קודם את db/upgrades/2026-11-19-report-closing-role. לא בוצע כלום.';
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
SELECT 'עמודת קוד משלוח יוצא (צריך 0)' AS בדיקה, count(*)::text AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'shipment_history' AND column_name = 'sent_shipment_code'
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`;

const outPath = path.join(here, "1-drop-sent-shipment-code.sql");
writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${m.checksum})`);
