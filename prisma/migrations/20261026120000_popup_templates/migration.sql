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
