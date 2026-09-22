/**
 * Builds 2-upgrade-to-packages.sql — ONE statement (a DO block) that takes a
 * production database from the pre-package schema to the converted state:
 * the package_model migration, its _prisma_migrations row, and every data
 * fix of 03-fix-production.sql. A DO block is atomic on its own, so the
 * operator never touches BEGIN / COMMIT / ROLLBACK: either everything is
 * applied, or an error message and nothing.
 *
 *   node scripts/prod-package-model/build-upgrade.mjs
 *
 * Sources (kept as the single truth, edit THEM, then rebuild):
 *   prisma/migrations/20260915120000_package_model/migration.sql
 *   scripts/prod-package-model/03-fix-production.sql   (CONFIG + steps 1–8)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const migrationName = "20260915120000_package_model";
const migrationPath = path.join(repo, "prisma", "migrations", migrationName, "migration.sql");
const fixPath = path.join(here, "03-fix-production.sql");
const outPath = path.join(here, "2-upgrade-to-packages.sql");

const migration = fs.readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");
const checksum = createHash("sha256").update(Buffer.from(migration, "utf8")).digest("hex");
const fix = fs.readFileSync(fixPath, "utf8").replace(/\r\n/g, "\n");

// ---- the migration, as plpgsql statements -----------------------------------
// The only construct plpgsql cannot run verbatim is a bare SELECT (setval):
// it needs PERFORM. Everything else (DDL, INSERT … ON CONFLICT, UPDATE,
// CREATE OR REPLACE FUNCTION with $$ bodies) runs as-is inside a $upgrade$
// block.
const migrationBody = migration
  .replace(/^SELECT setval\(/m, "PERFORM setval(")
  .split("\n")
  .map((l) => (l.trim() === "" ? "" : "  " + l))
  .join("\n");
if (!/PERFORM setval\(/.test(migrationBody)) throw new Error("expected the setval statement in the migration");
if (/^\s*SELECT\s/m.test(migrationBody.replace(/\$\$[\s\S]*?\$\$/g, ""))) {
  throw new Error("the migration has a top-level SELECT plpgsql cannot run — extend the builder");
}

// ---- the fix: DECLARE section and steps 1–8 from 03 -------------------------
const declMatch = fix.match(/DO \$fix\$\nDECLARE\n([\s\S]*?)\nBEGIN\n/);
if (!declMatch) throw new Error("03-fix-production.sql: DECLARE section not found");
let decl = declMatch[1];
// strict by default: a blocked group aborts the whole upgrade, nothing half-done.
decl = decl.replace("cfg_strict boolean := false;", "cfg_strict boolean := true;");
if (!decl.includes("cfg_strict boolean := true;")) throw new Error("cfg_strict default not found");

const bodyMatch = fix.match(/\nBEGIN\n([\s\S]*?)\nEND\n\$fix\$;/);
if (!bodyMatch) throw new Error("03-fix-production.sql: body not found");
let body = bodyMatch[1];
// Step 0 of 03 requires the NEW schema; here the migration runs first, so the
// precondition is the OLD schema (see precheck below).
const step0 = body.match(/  -- -{20,} 0\. תנאים\n[\s\S]*?(?=\n  -- -{20,} 1\.)/);
if (!step0) throw new Error("03-fix-production.sql: step 0 not found");
body = body.replace(step0[0], "").replace(/^\n+/, "");

const out = `-- =============================================================================
-- שדרוג DB הייצור למודל המארזים — הכול בפעולה אחת
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${migrationName}/migration.sql   (הסכימה)
--   scripts/prod-package-model/03-fix-production.sql   (סידור הנתונים)
--
-- מה קורה כשמריצים (בסדר הזה, הכול או כלום):
--   א. בדיקות מקדימות: הסכימה ישנה, המיגרציה לא רשומה, סטטוס 6 פנוי.
--   ב. המיגרציה: טבלת package_contents, עמודות המארז על items, package_level
--      על סוגי העמדות, סטטוס 6, שינויי ה-ledger.
--   ג. רישום המיגרציה ב-_prisma_migrations (הגרסה החדשה לא תריץ אותה שוב).
--   ד. סידור הנתונים: שורות מסלול יתומות, דגלי פתיחה/סגירה, סוגי מארז
--      ותכולות, תיקון מסלולים, הצהרות המשלוחים לפי סוגי מארז, והמרת כל
--      פריט ישן למארז עם מזהה חדש (ledger, קבצים ורשומות מחקר עוברים איתו).
--   ה. אם קבוצה כלשהי חסומה — שגיאה עם הסיבה, ושום דבר לא נשמר.
--
-- לפני ההרצה: לעצור את האפליקציה, ולהריץ את 1-backup-before-packages.ps1.
--
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script). בסוף מוצגות שתי
-- לשוניות: הדוח, ומיפוי המזהים ישן→חדש. המיפוי נשמר גם בטבלה legacy_id_map.
-- הרצה חוזרת מסרבת לרוץ ("הסכימה כבר שודרגה") — זה תקין.
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-upgrade-to-packages.sql
-- =============================================================================

DROP TABLE IF EXISTS fix_report;
CREATE TEMP TABLE fix_report (ord serial, step text, detail text);
DROP TABLE IF EXISTS fix_idmap;
CREATE TEMP TABLE fix_idmap (legacy_id bigint, new_id bigint, package_id bigint, package_seq int, item_type text, serial_no text, shipment_code text);
DROP TABLE IF EXISTS fix_group;
CREATE TEMP TABLE fix_group (
  item_id bigint, customer_id int, item_type_id int, type_desc text, shipment_id int, serial_no text, makat text,
  model text, manufacturer_name text, manufacturer_no text, current_status int, current_route_step int,
  is_finished boolean, route_number int, created_at timestamp, queue_start_time timestamp, ord int, new_route_number int
);

DO $upgrade$
DECLARE
${decl}
BEGIN
  -- ============================================================ א. בדיקות
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'parent_item_id') THEN
    RAISE EXCEPTION 'הסכימה כבר שודרגה (אין items.parent_item_id) — הסקריפט כבר רץ. לא בוצע כלום.';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${migrationName}') THEN
    RAISE EXCEPTION 'המיגרציה ${migrationName} כבר רשומה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'route_run') THEN
    RAISE EXCEPTION 'טבלאות ה-ledger חסרות (route_run) — חסרות מיגרציות קודמות. לא בוצע כלום.';
  END IF;
  IF EXISTS (SELECT 1 FROM item_status WHERE item_status_id = 6 AND TRIM(item_status_desc) <> 'ממתין לפריטי המארז') THEN
    RAISE EXCEPTION 'סטטוס 6 תפוס בשם אחר — יש לפנות אותו לפני השדרוג. לא בוצע כלום.';
  END IF;
  IF cfg_research_policy NOT IN ('reset', 'skip') OR cfg_files_policy NOT IN ('move', 'skip') THEN
    RAISE EXCEPTION 'CONFIG: ערך לא חוקי ב-cfg_research_policy / cfg_files_policy';
  END IF;
  INSERT INTO fix_report(step, detail) VALUES ('0 סביבה', current_database() || ' · ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  -- ============================================================ ב. המיגרציה
${migrationBody}

  -- ============================================================ ג. רישום
  INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid()::text, '${checksum}', now(), '${migrationName}', NULL, NULL, now(), 1);
  INSERT INTO fix_report(step, detail) VALUES ('0 מיגרציה', '${migrationName} הוחלה ונרשמה');

  -- ============================================================ ד. הנתונים
${body}
END
$upgrade$;

-- מיפוי המזהים נשמר גם בטבלה קבועה, לא רק בלשונית
-- Read by the app: /api/testing/locate-by-barcode answers a scan of an OLD label
-- through it, and /packages offers new labels for every box whose
-- relabeled_at is still NULL (set when they are printed). Not in
-- schema.prisma; guarded in scripts/check-migration-safety.js.
CREATE TABLE IF NOT EXISTS legacy_id_map (
  legacy_id bigint, new_id bigint, package_id bigint, package_seq int, item_type text, serial_no text, shipment_code text,
  converted_at timestamptz NOT NULL DEFAULT now(),
  relabeled_at timestamptz
);
-- A map created by the first version of this file lacks the column; harmless on a new one.
ALTER TABLE legacy_id_map ADD COLUMN IF NOT EXISTS relabeled_at timestamptz;
CREATE INDEX IF NOT EXISTS legacy_id_map_legacy_idx ON legacy_id_map (legacy_id);
INSERT INTO legacy_id_map (legacy_id, new_id, package_id, package_seq, item_type, serial_no, shipment_code)
SELECT legacy_id, new_id, package_id, package_seq, item_type, serial_no, shipment_code FROM fix_idmap;

-- הדוח (לשונית 1) ומיפוי המזהים (לשונית 2)
SELECT step, detail FROM fix_report ORDER BY ord;
SELECT package_id, package_seq, new_id, legacy_id, item_type, serial_no, shipment_code FROM fix_idmap ORDER BY package_id, package_seq;
`;

fs.writeFileSync(outPath, out, "utf8");
console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines, migration sha256 ${checksum})`);
