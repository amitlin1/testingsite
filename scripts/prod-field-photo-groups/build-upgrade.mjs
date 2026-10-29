// Builds the production upgrade for the photo fields' own photo groups (docs/popup-templates/PLAN.md §5א):
//   1-field-photo-groups.sql  ← prisma/migrations/20261029120000_field_photo_groups (required, before the image)
//   2-field-photos-dry-run.sql   which photos taken through a field would move to its group (read only)
//   3-field-photos-move.sql      moves them (optional; can wait, can be undone)
//   4-field-photos-undo.sql      puts every moved photo back in the group it had
// 1 is byte-for-byte the migration Prisma knows, and the _prisma_migrations row carries its real
// checksum (a later `prisma migrate deploy` then sees it as applied and never runs it again).
// 2 and 3 share one definition of what moves (MOVES), so the dry run reports exactly what the
// move does.
//
//   node scripts/prod-field-photo-groups/build-upgrade.mjs
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

const PREVIOUS = "20261027100000_shipment_box_lines";
const m = readMigration("20261029120000_field_photo_groups");

const RUN = (file) => `-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f ${file}`;

const NEEDS_1 = `DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'קודם להריץ את 1-field-photo-groups.sql (המיגרציה ${m.name} חסרה). לא בוצע כלום.';
  END IF;
END
$check$;`;

// What moves: every photo a saved result names in a photo field's value. A result's fields are in
// details.fields (with details.schema: the route and step the popup was built from) and, on a box
// row of the closing, in details.decisions[i].fields (same route and step). The photo goes to the
// group of that route, step and field — fieldPhotoCode in src/app/lib/station-fields/schema.ts.
// A key two different fields name (never seen; a guard) does not move.
const MOVES = `CREATE OR REPLACE TEMP VIEW field_photo_shots AS
WITH blocks AS (
  SELECT r.test_result_id, r.test_station_type_id,
         r.details->'schema'->>'route_id' AS route_id, r.details->'schema'->>'step_uid' AS step_uid,
         r.details->'fields' AS fields
    FROM test_results r
   WHERE jsonb_typeof(r.details->'schema') = 'object' AND jsonb_typeof(r.details->'fields') = 'object'
  UNION ALL
  SELECT r.test_result_id, r.test_station_type_id,
         r.details->'schema'->>'route_id', r.details->'schema'->>'step_uid',
         d->'fields'
    FROM test_results r
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.details->'decisions') = 'array' THEN r.details->'decisions' ELSE '[]'::jsonb END) AS d
   WHERE jsonb_typeof(r.details->'schema') = 'object' AND jsonb_typeof(r.details->'decisions') = 'array'
     AND jsonb_typeof(d->'fields') = 'object'
)
SELECT b.test_result_id, b.test_station_type_id,
       b.route_id::int AS test_route_id, b.step_uid, fv.key AS field_id,
       'r' || b.route_id || '.' || b.step_uid || '.' || fv.key AS new_code,
       fv.value->>'photo_type' AS saved_code,
       COALESCE(fv.value->>'label', '') AS saved_label,
       k AS object_key
  FROM blocks b
 CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(b.fields) = 'object' THEN b.fields ELSE '{}'::jsonb END) AS fv
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(fv.value->'photos') = 'array' THEN fv.value->'photos' ELSE '[]'::jsonb END) AS k
 WHERE fv.value->>'t' = 'photo' AND k <> ''
   AND b.route_id ~ '^[0-9]{1,9}$' AND b.step_uid ~ '^s_[a-z0-9]{8}$' AND fv.key ~ '^f_[a-z0-9]{8}$';

CREATE OR REPLACE TEMP VIEW field_photo_moves AS
WITH per_key AS (
  SELECT object_key, min(new_code) AS new_code, count(DISTINCT new_code) AS codes
    FROM field_photo_shots GROUP BY object_key
)
SELECT pk.object_key, pk.new_code, pk.codes > 1 AS conflict,
       fo.id AS file_id, fo.metadata->>'photoType' AS current_code,
       fo.id IS NOT NULL AND jsonb_typeof(fo.metadata) = 'object' AS found,
       fo.id IS NOT NULL AND jsonb_typeof(fo.metadata) = 'object'
         AND pk.codes = 1 AND (fo.metadata->>'photoType') IS DISTINCT FROM pk.new_code AS to_move
  FROM per_key pk
  LEFT JOIN file_objects fo ON fo.object_key = pk.object_key;`;

write("1-field-photo-groups.sql", `-- =============================================================================
-- שדה צילום במסלול מקבל קבוצת צילום משלו (עמודות הבעלות, וקבוצה לכל שדה שפורסם)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/${m.name}/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: ${PREVIOUS} כבר רשומה, והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): photo_types.test_route_id / step_uid / field_id, אינדקס ייחודי,
--      ושורה ב-photo_types לכל שדה צילום שפורסם במסלול כלשהו — "{סוג העמדה} · {שם השדה}".
--      אף תמונה לא זזה. העברת התמונות הקיימות לקבוצת השדה היא צעד נפרד ורשות (2–4).
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
${RUN("1-field-photo-groups.sql")}
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${m.name}') THEN
    RAISE EXCEPTION 'מיגרציית קבוצות הצילום של השדות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '${PREVIOUS}') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (${PREVIOUS}) חסרה — להריץ קודם את המיגרציות שלפניה. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
${m.sql.trimEnd()}

-- ================================================================= ג. רישום
${register(m)}

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-photo_types' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'photo_types' AND column_name IN ('test_route_id', 'step_uid', 'field_id')
UNION ALL
SELECT 'קבוצות של שדות צילום', count(*)::text FROM photo_types WHERE test_route_id IS NOT NULL
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '${m.name}';
`);

write("2-field-photos-dry-run.sql", `-- =============================================================================
-- ריצה יבשה: אילו תמונות שצולמו בשדה צילום יעברו לקבוצה של השדה (קריאה בלבד)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs. לא משנה דבר — אפשר להריץ בכל זמן, כמה פעמים שרוצים.
--
-- מה עובר: כל תמונה שתוצאה שמורה מונה בשדה צילום (test_results.details — fields, ובסגירה גם
-- decisions[i].fields). התוצאה שומרת את מפתחות התמונות של כל שדה, ולכן ידוע בדיוק איזו תמונה
-- צולמה באיזה שדה. התמונה עוברת לקבוצה של המסלול, השלב והשדה האלה.
-- מה לא עובר: תמונה שצולמה ולא נשמרה בתוצאה (חלון שבוטל), ותמונות של מסכים אחרים באותה
-- קבוצה (עמדת צילום, רכיב צילום בתבנית). הן נשארות בקבוצה שלהן.
-- התוצאות השמורות עצמן לא משתנות.
--
-- להריץ אחרי 1-field-photo-groups.sql.
${RUN("2-field-photos-dry-run.sql")}
-- =============================================================================

${NEEDS_1}

${MOVES}

-- ---------------------------------------------------------------- סיכום
SELECT נושא, מספר FROM (
  SELECT 1 AS n, 'תמונות שיעברו לקבוצת השדה' AS נושא, count(*) FILTER (WHERE to_move)::text AS מספר FROM field_photo_moves
  UNION ALL
  SELECT 2, 'כבר בקבוצת השדה (לא ישתנו)', count(*) FILTER (WHERE found AND NOT conflict AND NOT to_move)::text FROM field_photo_moves
  UNION ALL
  SELECT 3, 'מפתח שאין לו קובץ (לא ישתנה)', count(*) FILTER (WHERE NOT found)::text FROM field_photo_moves
  UNION ALL
  SELECT 4, 'מפתח ששני שדות שונים מונים (לא ישתנה)', count(*) FILTER (WHERE conflict)::text FROM field_photo_moves
  UNION ALL
  SELECT 5, 'תוצאות שמורות עם תמונות בשדה', count(DISTINCT test_result_id)::text FROM field_photo_shots
  UNION ALL
  SELECT 6, 'שדות צילום עם תמונות', count(DISTINCT new_code)::text FROM field_photo_shots
  UNION ALL
  SELECT 7, 'שדות שאין להם קבוצה עדיין (ההעברה תיצור)', count(DISTINCT s.new_code)::text
    FROM field_photo_shots s WHERE NOT EXISTS (SELECT 1 FROM photo_types p WHERE p.code = s.new_code)
) t ORDER BY n;

-- ---------------------------------------------------------- לפי שדה
SELECT mv.new_code AS קבוצת_השדה,
       COALESCE(p.photo_type_desc, '(תיווצר בהעברה)') AS שם,
       string_agg(DISTINCT COALESCE(mv.current_code, '(בלי קבוצה)'), ', ') FILTER (WHERE mv.to_move) AS מקבוצות,
       count(*) FILTER (WHERE mv.to_move) AS יעברו,
       count(*) FILTER (WHERE mv.found AND NOT mv.conflict AND NOT mv.to_move) AS כבר_שם
  FROM field_photo_moves mv
  LEFT JOIN photo_types p ON p.code = mv.new_code
 GROUP BY mv.new_code, p.photo_type_desc
 ORDER BY mv.new_code;

-- ------------------------------------------ מה נשאר בקבוצות הישנות
-- תמונות פריטים בקבוצות ששדות השתמשו בהן, שאף תוצאה לא מונה בשדה: צולמו במסך אחר, או בחלון שבוטל.
SELECT fo.metadata->>'photoType' AS קבוצה, count(*) AS נשארות
  FROM file_objects fo
 WHERE fo.entity_type = 'item_attachment' AND fo.status <> 'deleted'
   AND fo.metadata->>'photoType' IN (SELECT DISTINCT saved_code FROM field_photo_shots WHERE saved_code IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM field_photo_moves mv WHERE mv.object_key = fo.object_key)
 GROUP BY 1 ORDER BY 1;
`);

write("3-field-photos-move.sql", `-- =============================================================================
-- העברת התמונות שצולמו בשדה צילום לקבוצה של השדה (רשות; אפשר לבטל עם 4)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs. לפני: להריץ את 2-field-photos-dry-run.sql ולקרוא.
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקה: 1-field-photo-groups.sql הוחל.
--   ב. שדה שתמונה שלו עוברת ואין לו עדיין קבוצה (גרסה שלא נמצאה) — נוצרת לו קבוצה בשם
--      "{סוג העמדה של התוצאה} · {שם השדה בתוצאה}".
--   ג. לכל תמונה שעוברת (בדיוק מה ש-2 הראה): file_objects.metadata.photoType = קבוצת השדה,
--      והקבוצה הקודמת נשמרת ב-metadata.photoTypeBefore — זה מה ש-4 מחזיר.
--   ד. בסוף: הסיכום של 2 שוב (קריאה בלבד) — "יעברו" צריך להיות 0.
--
-- התמונות עצמן (ב-MinIO) והתוצאות השמורות לא משתנות; משתנה רק התיוג. בהיסטוריית הפריט
-- התמונה מופיעה מעכשיו בשם הקבוצה של השדה.
-- אפשר להריץ אחרי שה-image החדש עלה, בכל זמן. הרצה חוזרת מעבירה רק מה שעוד לא עבר.
${RUN("3-field-photos-move.sql")}
-- =============================================================================

BEGIN;

${NEEDS_1}

${MOVES}

-- ============================================== ב. קבוצה לשדה שאין לו
INSERT INTO photo_types (code, photo_type_desc, sort_order, is_active, test_route_id, step_uid, field_id)
SELECT s.new_code,
       LEFT(COALESCE(NULLIF(TRIM(t.test_type_desc), ''), '') || ' · ' || COALESCE(NULLIF(TRIM(s.saved_label), ''), 'צילום'), 255),
       (SELECT COALESCE(MAX(sort_order), 0) FROM photo_types) + ROW_NUMBER() OVER (ORDER BY s.new_code),
       true, s.test_route_id, s.step_uid, s.field_id
  FROM (SELECT DISTINCT ON (new_code) new_code, test_route_id, step_uid, field_id, saved_label, test_station_type_id
          FROM field_photo_shots ORDER BY new_code, test_result_id DESC) s
  LEFT JOIN test_stations_type t ON t.test_station_type_id = s.test_station_type_id
 WHERE NOT EXISTS (SELECT 1 FROM photo_types p WHERE p.code = s.new_code)
ON CONFLICT DO NOTHING;

-- ============================================== ג. התיוג
UPDATE file_objects fo
   SET metadata = fo.metadata
                  || jsonb_build_object('photoType', mv.new_code)
                  || CASE WHEN fo.metadata ? 'photoTypeBefore' THEN '{}'::jsonb
                          ELSE jsonb_build_object('photoTypeBefore', COALESCE(fo.metadata->'photoType', 'null'::jsonb)) END,
       updated_at = now()
  FROM field_photo_moves mv
 WHERE mv.to_move AND fo.id = mv.file_id;

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'יעברו (צריך להיות 0)' AS נושא, count(*) FILTER (WHERE to_move)::text AS מספר FROM field_photo_moves
UNION ALL
SELECT 'בקבוצת השדה', count(*) FILTER (WHERE found AND NOT conflict AND NOT to_move)::text FROM field_photo_moves
UNION ALL
SELECT 'אפשר להחזיר עם 4', count(*)::text FROM file_objects WHERE metadata ? 'photoTypeBefore';
`);

write("4-field-photos-undo.sql", `-- =============================================================================
-- ביטול העברת התמונות: כל תמונה ש-3 העביר חוזרת לקבוצה שהייתה לה
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs.
--
-- מחזיר רק את מה ש-3 העביר (התמונות שיש להן metadata.photoTypeBefore): photoType = הקבוצה
-- הקודמת (או בלי קבוצה, אם לא הייתה), ו-photoTypeBefore נמחק. קבוצות השדות נשארות (בלי
-- תמונות ישנות), ותמונות חדשות ממשיכות להיכנס לקבוצת השדה — זה הקוד, לא ההעברה.
-- הרצה חוזרת לא משנה דבר.
${RUN("4-field-photos-undo.sql")}
-- =============================================================================

BEGIN;

UPDATE file_objects
   SET metadata = CASE WHEN jsonb_typeof(metadata->'photoTypeBefore') = 'null'
                       THEN metadata - 'photoTypeBefore' - 'photoType'
                       ELSE (metadata - 'photoTypeBefore') || jsonb_build_object('photoType', metadata->'photoTypeBefore') END,
       updated_at = now()
 WHERE jsonb_typeof(metadata) = 'object' AND metadata ? 'photoTypeBefore';

COMMIT;

SELECT 'נשארו מסומנות כמועברות (צריך להיות 0)' AS נושא, count(*)::text AS מספר
  FROM file_objects WHERE metadata ? 'photoTypeBefore';
`);
