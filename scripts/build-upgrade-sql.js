// Build the single all-in-one upgrade script an operator runs in DBeaver.
//
//   node scripts/build-upgrade-sql.js
//
// Concatenates, in the order they must run:
//   1. research_history.item_id  int4 -> bigint
//   2. the metrics ledger migration (additive only)
//   3. the Tier-1 backfill
//   4. test_stations_type.stale_after_minutes
//
// plus pre-flight guards, the _prisma_migrations bookkeeping rows (with real
// checksums, so a later `prisma migrate deploy` does not re-run any of them),
// and three verification queries with the expected answers written next to them.
//
// The DESTRUCTIVE migration is deliberately NOT part of this file. Its whole
// safety story is that it runs a week later, after the daily drift check has
// proved the new system correct. Merging it in would defeat that.
//
// Regenerate this whenever any of the four source files changes — the embedded
// checksums are computed from them at build time.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repo = path.join(__dirname, "..");
const out = path.join(repo, "release", "db-scripts", "UPGRADE_ALL_IN_ONE.sql");

const SRC = {
  bigint: "prisma/migrations/20260824090000_research_history_item_id_bigint/migration.sql",
  ledger: "prisma/migrations/20260825000000_metrics_ledger_additive/migration.sql",
  backfill: "prisma/backfill/tier1_backfill.sql",
  stale: "prisma/migrations/20260828090000_station_type_stale_timeout/migration.sql",
};

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);
// Always read through LF, never the raw bytes on disk. core.autocrlf checks
// these files out with CRLF on Windows, and hashing that gives a checksum
// that does not match the one prisma computes inside the Linux container,
// where the same file is LF. The mismatch is invisible here and fatal there:
// the next `prisma migrate deploy` reads the LF file, computes a checksum
// different from the one this script wrote into _prisma_migrations, and
// refuses to deploy -- "migration modified after being applied". Normalising
// also makes the generated script byte-identical whoever regenerates it.
const read = (rel) =>
  fs.readFileSync(path.join(repo, rel), "utf8").split(CRLF).join(LF);
const sha = (rel) => crypto.createHash("sha256").update(read(rel), "utf8").digest("hex");

const MIGRATION_NAMES = {
  bigint: "20260824090000_research_history_item_id_bigint",
  ledger: "20260825000000_metrics_ledger_additive",
  stale: "20260828090000_station_type_stale_timeout",
};

function bookkeeping(key) {
  return `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, '${sha(SRC[key])}', now(), '${MIGRATION_NAMES[key]}', NULL, NULL, now(), 1
 WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${MIGRATION_NAMES[key]}');`;
}

function section(n, title, why, key) {
  return `
-- ===========================================================================
--  חלק ${n} מתוך 4 — ${title}
--  ${why}
-- ===========================================================================

${read(SRC[key])}`;
}

const header = `-- ===========================================================================
--  שדרוג מערכת המטריקות — קובץ אחד להרצה ב-DBeaver
-- ===========================================================================
--
--  מה הוא עושה:
--    1. מתקן עמודה שגולשת ומפילה שמירת מחקר
--    2. יוצר את סכימת הלדג'ר החדשה
--    3. ממלא אותה מהמצב הקיים
--    4. מוסיף סף שחרור אוטומטי לכל סוג תחנה
--
--  מה הוא *לא* עושה: הוא לא מוחק כלום. אף טבלה קיימת לא נמחקת ואף נתון לא
--  הולך לאיבוד. הדשבורד הישן ימשיך לעבוד בדיוק כמו קודם.
--  המחיקה היא קובץ נפרד — 05_DESTRUCTIVE_drop_legacy.sql — שרץ רק שבוע אחרי,
--  אחרי שהבדיקה היומית הוכיחה שהמערכת החדשה נכונה.
--
-- ---------------------------------------------------------------------------
--  איך מריצים
-- ---------------------------------------------------------------------------
--   1. גיבוי טרי של בסיס הנתונים. ולוודא שהוא נטען.
--   2. להתחבר ב-DBeaver *באותו משתמש שאיתו הותקן הקונטיינר*
--      (POSTGRES_USER מקובץ ה-.env של שרת ה-DB). נדרשות הרשאות superuser
--      כדי ליצור extension.
--   3. Alt+X  ("Execute script") — לא Ctrl+Enter. זה סקריפט שלם, לא שאילתה.
--
--  הכול רץ בטרנזקציה אחת: או שהכול נכנס, או ששום דבר לא נכנס. אם משהו נכשל,
--  בסיס הנתונים חוזר בדיוק למצב שלפני ההרצה ותופיע שגיאה שמסבירה מה לתקן.
--  אחרי התיקון אפשר להריץ את הקובץ שוב — הוא בטוח להרצה חוזרת.
--
--  בסוף מוצגות שלוש טבלאות בדיקה. מה צריך לראות בהן כתוב שם.
--
--  אחרי הסקריפט: להעלות את ה-image החדש של האפליקציה, ואז להריץ
--  8-register-tasks.ps1 בהרשאות מנהל (שלוש המשימות המתוזמנות).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
--  בדיקות מקדימות — נכשלות ברעש לפני שנוגעים במשהו
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE v_dupes text; v_missing text;
BEGIN
  -- הטבלאות שהסקריפט נשען עליהן. אם אחת חסרה, זה בסיס הנתונים הלא נכון.
  SELECT string_agg(t, ', ') INTO v_missing
    FROM unnest(ARRAY['items','item_routes','testing_routes','test_stations',
                      'test_stations_type','shipments','customers','research_history']) AS t
   WHERE to_regclass('public.' || t) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'\\n\\n  זה לא בסיס הנתונים של המערכת — חסרות הטבלאות: %\\n', v_missing;
  END IF;

  -- כפילויות שהאינדקס הייחודי החדש לא יוכל לקבל. עדיף לדעת עכשיו, בשם.
  SELECT string_agg(format('(item_type_id=%s, route_number=%s)', item_type_id, route_number), ', ')
    INTO v_dupes
    FROM (SELECT item_type_id, route_number FROM testing_routes
           GROUP BY 1,2 HAVING count(*) > 1) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION E'\\n\\n  יש מסלולי בדיקה כפולים. צריך למחוק את העודפים לפני השדרוג:\\n  %\\n', v_dupes;
  END IF;

  RAISE NOTICE 'בדיקות מקדימות עברו.';
END $preflight$;

-- טבלת הרישום של prisma. בהתקנה ותיקה היא לפעמים חסרה, והרישום בסוף הקובץ
-- נשען עליה.
CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id                  varchar(36)  PRIMARY KEY,
  checksum            varchar(64)  NOT NULL,
  finished_at         timestamptz,
  migration_name      varchar(255) NOT NULL,
  logs                text,
  rolled_back_at      timestamptz,
  started_at          timestamptz  NOT NULL DEFAULT now(),
  applied_steps_count integer      NOT NULL DEFAULT 0
);
`;

const footer = `
-- ===========================================================================
--  רישום המיגרציות
--  בלי השורות האלה, פריסה עתידית תחשוב שהשדרוג לא רץ ותנסה להריץ אותו שוב.
-- ===========================================================================
${bookkeeping("bigint")}

${bookkeeping("ledger")}

${bookkeeping("stale")}

COMMIT;

-- ===========================================================================
--  בדיקה 1 — האם הלדג'ר התמלא?
--  items_with_state צריך להיות שווה ל-item_routes_total (פחות שורות יתומות,
--  אם יש כאלה). אם הוא 0 — שום דבר לא נכנס. לעצור ולברר לפני שמעלים את
--  האפליקציה.
-- ===========================================================================
SELECT (SELECT count(*) FROM item_routes)                        AS item_routes_total,
       (SELECT count(*) FROM route_run)                          AS runs_created,
       (SELECT count(DISTINCT item_id) FROM item_state_interval) AS items_with_state,
       (SELECT count(*) FROM item_state_event)                   AS events;

-- ===========================================================================
--  בדיקה 2 — האם הלדג'ר מסכים עם המצב התפעולי?
--  חייב להחזיר 0. כל מספר אחר אומר שפריט נרשם במצב שונה ממה שהמערכת הישנה
--  חושבת — לברר לפני שממשיכים.
-- ===========================================================================
SELECT count(*) AS items_where_ledger_disagrees
  FROM item_routes ir
  LEFT JOIN item_state_interval i
         ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
 WHERE EXISTS (SELECT 1 FROM item_state_interval x WHERE x.item_id = ir.item_id)
   AND i.state_key IS DISTINCT FROM state_of(ir.current_status);

-- ===========================================================================
--  בדיקה 3 — תקינות כללית
--  כל value חייב להיות 0, חוץ מ:
--    open_intervals               — כמה פריטים חיים יש. מספר גדול זה תקין.
--    calendar_horizon_days        — ריק בשלב הזה. לוח שעות העבודה נבנה אחרי
--                                   שהאפליקציה עולה והמשימה הלילית רצה.
--    calendar_sanity_net_minutes  — אותו דבר.
--    ledger_bytes                 — גודל בדיסק.
-- ===========================================================================
SELECT * FROM metrics_selfcheck();
`;

const sql =
  header +
  section(1, "תיקון עמודה שגולשת",
    "item_id של מחקר היה קטן מדי, ושמירת מחקר על פריט עם מזהה ארוך נכשלה.", "bigint") +
  section(2, "סכימת הלדג'ר",
    "יוצר את הטבלאות החדשות. לא נוגע בטבלה קיימת מלבד הוספות.", "ledger") +
  section(3, "מילוי ראשוני",
    "רושם את המצב הנוכחי של כל פריט. לא ממציא היסטוריה — היא תצטבר מכאן.", "backfill") +
  section(4, "סף שחרור לכל סוג תחנה",
    "עמודה אחת. 30 דקות כברירת מחדל; 0 = לעולם לא לשחרר אוטומטית.", "stale") +
  footer;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sql, "utf8");
console.log(`wrote ${path.relative(repo, out)} — ${sql.split("\n").length} lines`);
