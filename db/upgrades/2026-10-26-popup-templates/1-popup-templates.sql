-- =============================================================================
-- תבניות חלון לעמדות בדיקה (טבלאות התבנית, הגרסאות, ושיוך קבוצות צילום לרכיב)
-- =============================================================================
-- נבנה אוטומטית על ידי build-upgrade.mjs מתוך:
--   prisma/migrations/20261026120000_popup_templates/migration.sql
--
-- מה קורה כשמריצים (בטרנזקציה אחת, הכול או כלום):
--   א. בדיקות מקדימות: 20261021120000_reference_items_parent כבר רשומה, והמיגרציה הזו עוד לא רשומה.
--   ב. המיגרציה (תוספות בלבד): station_popup_templates, station_popup_template_versions
--      (שתי טבלאות ריקות), ו-photo_types.test_station_type_id / component_id (ריקות).
--      שום נתון לא משתנה. בלי שורה בטבלת התבניות כל עמדה פותחת את החלון של היום.
--   ג. רישום המיגרציה ב-_prisma_migrations (checksum זהה לקובץ המיגרציה).
--   ד. בסוף: שאילתות בדיקה (קריאה בלבד).
--
-- סדר פריסה: להריץ לפני העלאת ה-image החדש. ה-image הקודם ממשיך לעבוד גם אחרי ההרצה.
-- גרסת הסכמה (metrics_schema_version) לא משתנה.
--
-- לפני ההרצה: גיבוי של ה-DB.
-- הרצה ב-DBeaver: לפתוח את הקובץ, Alt+X (Execute script).
-- ב-psql:  psql -U <user> -d <db> -v ON_ERROR_STOP=1 -f 1-popup-templates.sql
-- הרצה חוזרת נעצרת בבדיקה המקדימה ("כבר הוחלה") ולא משנה דבר — זה תקין.
-- =============================================================================

BEGIN;

-- ===================================================================== א. בדיקות
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261026120000_popup_templates') THEN
    RAISE EXCEPTION 'מיגרציית תבניות החלון כבר הוחלה. לא בוצע כלום.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261021120000_reference_items_parent') THEN
    RAISE EXCEPTION 'המיגרציה הקודמת (20261021120000_reference_items_parent) חסרה — להריץ קודם את המיגרציות שלפניה. לא בוצע כלום.';
  END IF;
END
$check$;

-- ================================================================= ב. המיגרציה
-- ============================================================================
-- Popup templates: the envelope of a station's test popup, one per station
-- type (docs/popup-templates/PLAN.md §3).
--
-- station_popup_templates: the current template of a station type — its base
-- ('item' / 'package'), the config (steps of components, validated by
-- src/app/lib/popup-templates/validate.ts) and its version. No row = the type
-- opens the popup the code gives it today, so this table can start empty.
--
-- station_popup_template_versions: every saved config, kept by (type, version).
-- It hangs off the station type, not off the template: deleting a template
-- and making a new one carries on the numbering, so a result's
-- details.template.v never points at two different configs.
--
-- photo_types.test_station_type_id / component_id: a template's photo
-- component owns one photo group (the photo is the group — PLAN §3.4). The
-- reference images and the worker photos keep pointing at the same row, so
-- nothing moves when an existing group is linked to a component. Both NULL =
-- a group no template owns (every row until a template is saved). Unique per
-- (type, component); NULLs are distinct, so unowned groups are not constrained.
--
-- Additive only: two new tables, two nullable columns. The previous image
-- keeps working after it (it never reads them), so this runs any time before
-- the new image. No metrics_schema_version bump: the ledger reads none of it.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "station_popup_templates" (
    "test_station_type_id" INTEGER NOT NULL,
    "base" VARCHAR(16) NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_by" VARCHAR(255),
    CONSTRAINT "station_popup_templates_pkey" PRIMARY KEY ("test_station_type_id"),
    CONSTRAINT "station_popup_templates_base_check" CHECK ("base" IN ('item', 'package')),
    CONSTRAINT "station_popup_templates_version_check" CHECK ("version" >= 1)
);

CREATE TABLE IF NOT EXISTS "station_popup_template_versions" (
    "test_station_type_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "base" VARCHAR(16) NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_by" VARCHAR(255),
    CONSTRAINT "station_popup_template_versions_pkey" PRIMARY KEY ("test_station_type_id", "version")
);

ALTER TABLE "photo_types" ADD COLUMN IF NOT EXISTS "test_station_type_id" INTEGER;
ALTER TABLE "photo_types" ADD COLUMN IF NOT EXISTS "component_id" VARCHAR(16);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_station_popup_templates_type') THEN
        ALTER TABLE "station_popup_templates"
            ADD CONSTRAINT "fk_station_popup_templates_type"
            FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_station_popup_template_versions_type') THEN
        ALTER TABLE "station_popup_template_versions"
            ADD CONSTRAINT "fk_station_popup_template_versions_type"
            FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_photo_types_station_type') THEN
        ALTER TABLE "photo_types"
            ADD CONSTRAINT "fk_photo_types_station_type"
            FOREIGN KEY ("test_station_type_id") REFERENCES "test_stations_type"("test_station_type_id") ON DELETE SET NULL ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "photo_types_component_uq" ON "photo_types"("test_station_type_id", "component_id");

-- ================================================================= ג. רישום
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '16c220814f3d19b866ef2a45d7bdcb4ec97185e4baa6ca07c816aa8352fc9cc2', now(), '20261026120000_popup_templates', NULL, NULL, now(), 1);

COMMIT;

-- ============================================================ ד. בדיקה (קריאה בלבד)
SELECT 'טבלאות חדשות' AS בדיקה, string_agg(table_name, ', ' ORDER BY table_name) AS תוצאה
  FROM information_schema.tables
 WHERE table_name IN ('station_popup_templates', 'station_popup_template_versions')
UNION ALL
SELECT 'עמודות חדשות ב-photo_types', string_agg(column_name, ', ' ORDER BY column_name)
  FROM information_schema.columns
 WHERE table_name = 'photo_types' AND column_name IN ('test_station_type_id', 'component_id')
UNION ALL
SELECT 'רישום המיגרציה', count(*)::text FROM _prisma_migrations WHERE migration_name = '20261026120000_popup_templates';
