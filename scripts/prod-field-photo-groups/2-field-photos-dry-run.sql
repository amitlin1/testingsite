-- =============================================================================
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
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 2-field-photos-dry-run.sql
-- =============================================================================

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261029120000_field_photo_groups') THEN
    RAISE EXCEPTION 'קודם להריץ את 1-field-photo-groups.sql (המיגרציה 20261029120000_field_photo_groups חסרה). לא בוצע כלום.';
  END IF;
END
$check$;

CREATE OR REPLACE TEMP VIEW field_photo_shots AS
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
  LEFT JOIN file_objects fo ON fo.object_key = pk.object_key;

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
