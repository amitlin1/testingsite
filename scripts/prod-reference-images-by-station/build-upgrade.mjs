// Builds the production upgrade for reference images by station (docs/popup-templates/PLAN.md §5ג):
//   1-dry-run.sql                       which station each existing reference image goes to (read only;
//                                       run BEFORE 2 — it works on the schema of before and after)
//   2-reference-images-by-station.sql   ← prisma/migrations/20261029130000_reference_images_by_station
// 2 is byte-for-byte the migration Prisma knows, and the _prisma_migrations row carries its real
// checksum (a later `prisma migrate deploy` then sees it as applied and never runs it again).
// 1 reads the migration's own "station of a group" query (between its station-of-group markers),
// so the dry run reports exactly what the migration does.
//
//   node scripts/prod-reference-images-by-station/build-upgrade.mjs
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

const write = (file, out) => {
  const outPath = path.join(here, file);
  writeFileSync(outPath, out.replace(/\r\n/g, "\n"));
  console.log(`wrote ${path.relative(repo, outPath)} (${out.split("\n").length} lines)`);
};

const register = (m) => `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '${m.checksum}', now(), '${m.name}', NULL, NULL, now(), 1);`;

const PREVIOUS = "20261029120000_field_photo_groups";
const m = readMigration("20261029130000_reference_images_by_station");

const block = m.sql.replace(/\r\n/g, "\n").match(/-- station-of-group:begin\n([\s\S]*?)\n\s*-- station-of-group:end/);
if (!block) throw new Error("the migration has no station-of-group block");
const stationOfGroup = block[1].replace(/^ {8}/gm, "  ");

const RUN = (file) => `-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f ${file}`;

write("1-dry-run.sql", `-- =============================================================================
-- ריצה יבשה: לאיזו עמדה תשויך כל תמונת ייחוס קיימת (קריאה בלבד)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs, מאותה שאילתה שהמיגרציה (2) מריצה.
-- לא משנה דבר. להריץ לפני 2 (עובד גם אחריו).
--
-- כל תמונת ייחוס הועלתה לקבוצת צילום. היא עוברת לעמדה שמציגה את הקבוצה הזו היום — כשיש
-- בדיוק עמדה אחת כזו:
--   * רכיב צילום בתבנית של סוג העמדה שהקבוצה שלו;
--   * חלון הצילום של עמדה (CODE_POPUPS: סוג 2 ← קבוצה 3, סוג 5 ← קבוצה 4);
--   * הקבוצות 'package' / 'product' של אשף הפתיחה — לעמדות ברמת מארז שפותחות מארז.
-- קבוצה שאף עמדה לא מציגה, או שכמה עמדות מציגות: התמונות שלה נשארות "לא משויכות לעמדה".
-- בעמוד פריטי הייחוס בוחרים להן עמדה — בלי להעלות מחדש.
${RUN("1-dry-run.sql")}
-- =============================================================================

-- ---------------------------------------------------------------- לפי קבוצה
WITH m AS (
${stationOfGroup}
)
SELECT p.code AS קבוצה,
       p.photo_type_desc AS שם,
       count(i.*) AS תמונות_ייחוס,
       CASE WHEN m.stations = 1 THEN TRIM(t.test_type_desc)
            WHEN m.stations > 1 THEN '(לא תשויך: ' || m.stations || ' עמדות מציגות אותה)'
            ELSE '(לא תשויך: אף עמדה לא מציגה אותה)' END AS עמדה
  FROM photo_types p
  JOIN reference_item_images i ON i.photo_type_id = p.photo_type_id
  LEFT JOIN m ON m.photo_type_id = p.photo_type_id
  LEFT JOIN test_stations_type t ON t.test_station_type_id = m.station AND m.stations = 1
 GROUP BY p.code, p.photo_type_desc, m.stations, t.test_type_desc
 ORDER BY p.code;

-- ---------------------------------------------------------------- סיכום
WITH m AS (
${stationOfGroup}
)
SELECT count(*) FILTER (WHERE m.stations = 1) AS ישויכו_לעמדה,
       count(*) FILTER (WHERE m.stations IS DISTINCT FROM 1) AS יישארו_לא_משויכות
  FROM reference_item_images i
  LEFT JOIN m ON m.photo_type_id = i.photo_type_id;

-- ------------------------------------- פריטי ייחוס עם תמונות שיישארו לא משויכות
WITH m AS (
${stationOfGroup}
)
SELECT TRIM(it.item_type_desc) AS סוג_פריט, r.manufacturer_sku AS מקט, r.name AS שם, count(*) AS לא_משויכות
  FROM reference_item_images i
  JOIN reference_items r ON r.reference_item_id = i.reference_item_id
  JOIN item_types it ON it.item_type_id = r.item_type_id
  LEFT JOIN m ON m.photo_type_id = i.photo_type_id
 WHERE m.stations IS DISTINCT FROM 1
 GROUP BY 1, 2, 3
 ORDER BY 1, 2;
`);

write("2-reference-images-by-station.sql", `-- =============================================================================
-- תמונות ייחוס לפי סוג עמדה (במקום לפי קבוצת צילום)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: ${PREVIOUS} כבר רשומה, והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה: reference_item_images.test_station_type_id (חדשה), photo_type_id בלי NOT NULL,
--      אינדקס — וכל תמונת ייחוס מקבלת את העמדה שמציגה את הקבוצה שלה, כמו ש-1-dry-run.sql הראה.
--      הקבוצה שהתמונה הועלתה אליה נשארת רשומה כמו שהייתה.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה (הוא לא
-- קורא את העמודה החדשה). חזרה אחורה = ה-image הקודם; אין צורך לבטל את ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB, ו-1-dry-run.sql.
${RUN("2-reference-images-by-station.sql")}
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית תמונות הייחוס לפי עמדה כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${PREVIOUS}') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (${PREVIOUS}) חסרה — להריץ קודם את scripts/prod-field-photo-groups/1-field-photo-groups.sql. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'תמונות ייחוס עם עמדה' AS בדיקה, count(*)::text AS תוצאה FROM reference_item_images WHERE test_station_type_id IS NOT NULL
UNION ALL
SELECT 'תמונות ייחוס לא משויכות (לבחור עמדה בעמוד פריטי הייחוס)', count(*)::text FROM reference_item_images WHERE test_station_type_id IS NULL
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`);
