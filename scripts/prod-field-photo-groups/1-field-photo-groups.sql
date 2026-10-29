-- =============================================================================
-- שדה צילום במסלול מקבל קבוצת צילום משלו (עמודות הבעלות, וקבוצה לכל שדה שפורסם)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261029120000_field_photo_groups/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: 20261027100000_shipment_box_lines כבר רשומה, והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): photo_types.test_route_id / step_uid / field_id, אינדקס ייחודי,
--      ושורה ב-photo_types לכל שדה צילום שפורסם במסלול כלשהו — "{סוג העמדה} · {שם השדה}".
--      אף תמונה לא זזה. העברת התמונות הקיימות לקבוצת השדה היא צעד נפרד ורשות (2–4).
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-field-photo-groups.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261029120000_field_photo_groups') THEN
    RAISE EXCEPTION 'מיגרציית קבוצות הצילום של השדות כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261027100000_shipment_box_lines') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (20261027100000_shipment_box_lines) חסרה — להריץ קודם את המיגרציות שלפניה. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- Route photo fields own their photo groups (docs/popup-templates/PLAN.md §5א).
--
-- WHY: a photo field on the testing-routes page used to name a photo group
-- the admin picked (PhotoField.photo_type), shared with whatever else used
-- that group. Now each field has a group of its own — one photo_types row
-- per route, step and field, code "r{route}.{step}.{field}"
-- (src/app/lib/station-fields/schema.ts fieldPhotoCode), named
-- "{station type} · {field label}" (photo-groups.ts fieldPhotoGroupDesc).
-- The worker's shots are tagged with it in every frozen version alike
-- (resolve.ts withFieldPhotoGroups); publishing creates and renames the rows.
--
-- photo_types.test_route_id / step_uid / field_id: the owning field. All
-- NULL = no field owns the group. Plain values with no FK: a route can go
-- away and its photos keep their group's name. Unique together; NULLs are
-- distinct, so groups no field owns are not constrained.
--
-- The backfill creates the group of every photo field in a published version
-- (route_field_versions), named after the newest version that has it, so the
-- photos the new image tags are named in the item's history from the first
-- shot. Nothing existing changes: no photo is re-tagged here. Moving the
-- photos already taken through a field into its group is a separate, optional
-- step (scripts/prod-field-photo-groups/2-*.sql).
--
-- Additive only: three nullable columns, one unique index, new rows. The
-- previous image keeps working after it (it lists the new rows among the
-- photo types, unused). No metrics_schema_version bump: the ledger reads
-- no photo group.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database; a group that exists is left as it is.
-- ============================================================================

ALTER TABLE "photo_types" ADD COLUMN IF NOT EXISTS "test_route_id" INTEGER;
ALTER TABLE "photo_types" ADD COLUMN IF NOT EXISTS "step_uid" VARCHAR(16);
ALTER TABLE "photo_types" ADD COLUMN IF NOT EXISTS "field_id" VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS "photo_types_field_uq" ON "photo_types"("test_route_id", "step_uid", "field_id");

WITH photo_fields AS (
    SELECT DISTINCT ON (v.test_route_id, s.key, f->>'id')
           v.test_route_id,
           s.key            AS step_uid,
           f->>'id'         AS field_id,
           COALESCE(f->>'label', '')                    AS label,
           (s.value->>'station_type_id')::int           AS station_type_id,
           COALESCE(s.value->>'station_label', '')      AS station_label
    FROM route_field_versions v
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(v.config->'steps') = 'object' THEN v.config->'steps' ELSE '{}'::jsonb END) AS s
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.value->'groups') = 'array' THEN s.value->'groups' ELSE '[]'::jsonb END) AS g
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g->'fields') = 'array' THEN g->'fields' ELSE '[]'::jsonb END) AS f
    WHERE f->>'type' = 'photo' AND f->>'id' IS NOT NULL
    ORDER BY v.test_route_id, s.key, f->>'id', v.version DESC
), named AS (
    SELECT pf.*,
           'r' || pf.test_route_id || '.' || pf.step_uid || '.' || pf.field_id AS code,
           LEFT(
             COALESCE(NULLIF(TRIM(t.test_type_desc), ''), TRIM(pf.station_label))
             || ' · ' || COALESCE(NULLIF(TRIM(pf.label), ''), 'צילום'),
             255) AS photo_type_desc
    FROM photo_fields pf
    LEFT JOIN test_stations_type t ON t.test_station_type_id = pf.station_type_id
), base AS (
    SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM photo_types
)
INSERT INTO photo_types (code, photo_type_desc, sort_order, is_active, test_route_id, step_uid, field_id)
SELECT n.code, n.photo_type_desc,
       base.max_sort + ROW_NUMBER() OVER (ORDER BY n.test_route_id, n.step_uid, n.field_id),
       true, n.test_route_id, n.step_uid, n.field_id
FROM named n CROSS JOIN base
WHERE NOT EXISTS (SELECT 1 FROM photo_types p WHERE p.code = n.code)
ON CONFLICT DO NOTHING;

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '5c77854126b2b840231f1fac118dfae022103e7aa252ced410fec4cdebcac65c', now(), '20261029120000_field_photo_groups', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'עמודות חדשות ב-photo_types' AS בדיקה, string_agg(column_name, ', ' ORDER BY column_name) AS תוצאה
  FROM information_schema.columns
 WHERE table_name = 'photo_types' AND column_name IN ('test_route_id', 'step_uid', 'field_id')
UNION ALL
SELECT 'קבוצות של שדות צילום', count(*)::text FROM photo_types WHERE test_route_id IS NOT NULL
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261029120000_field_photo_groups';
