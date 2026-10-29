-- =============================================================================
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
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 3-field-photos-move.sql
-- =============================================================================

BEGIN;

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
