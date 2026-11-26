// Builds the production upgrade for the external approval of a failed report (docs/features/ITEM_REPORTS.md):
//   1-report-external-approval.sql  ← prisma/migrations/20261126140000_report_external_approval
// so the SQL that runs in production is byte-for-byte the migration Prisma knows, and the
// _prisma_migrations row carries its real checksum (a later `prisma migrate deploy`
// then sees it as applied and never runs it again).
//
//   node db/upgrades/2026-11-26-report-external-approval/build-upgrade.mjs
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

const m = readMigration("20261126140000_report_external_approval");
const prev = "20261126120000_drop_sent_shipment_code";

const rows = (bind) =>
  `(SELECT count(*) FROM jsonb_array_elements(template::jsonb->'content') n
     WHERE n->>'type' = 'Signature' AND n->'props'->>'bind' = '${bind}')`;

const out = `-- =============================================================================
-- אישור גורם חיצוני לדוח שיצא "לא תקין"
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: המיגרציה הקודמת (${prev}) רשומה,
--      והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה:
--      - עמודות חדשות ב-item_reports: external_* (ריקות בכל השורות הקיימות) — שם הגורם
--        החיצוני, תפקיד/גוף, נימוק, החתימה, המנהל שהציג, מתי.
--      - בתבנית הכללית ובכל תבנית של מסלול: שורת חתימה "גורם חיצוני" מיד אחרי שורת
--        החתימה הסופית ("מאשר סופי"). היא מודפסת רק בדוח שאושר ע"י גורם חיצוני.
--        תבנית בלי שורת חתימה סופית לא משתנה. דוחות שכבר ננעלו לא משתנים.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ ממש לפני העלאת ה-image החדש. ה-image הקודם לא מכיר את השורה החדשה
-- ומדפיס אותה כשורת חתימה ריקה, כך שבין ההרצה להעלאה תופיע בטיוטות שורה ריקה נוספת.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-report-external-approval.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית האישור החיצוני כבר הוחלה. לא בוצע כלום.';
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
SELECT 'עמודות האישור החיצוני' AS בדיקה, count(*)::text || ' מתוך 8' AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'item_reports' AND column_name LIKE 'external\\_%'
UNION ALL
SELECT 'התבנית הכללית: שורות "גורם חיצוני" / "מאשר סופי"', ${rows("external")}::text || ' / ' || ${rows("final")}::text
  FROM report_general_template
UNION ALL
SELECT 'מסלול ' || test_route_id || ': שורות "גורם חיצוני" / "מאשר סופי"', ${rows("external")}::text || ' / ' || ${rows("final")}::text
  FROM report_templates
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`;

const outPath = path.join(here, "1-report-external-approval.sql");
writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${m.checksum})`);
