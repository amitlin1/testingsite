-- ============================================================================
-- reference_items: a package reference holds a reference item for each line
-- of its package type's contents.
--
-- WHY: a reference item of a package type described only the box. The
-- opening station now learns from the box label what should be inside it:
-- each content line gets its own reference item (SKU, weight, images), made
-- inside the package reference and owned by it — an "מחשב" in one package is
-- not the "מחשב" in another, so they are not shared with the regular screen.
--
-- parent_reference_id: NULL on a regular reference item and on a package
-- reference; set on a member, pointing at its package reference. Deleting the
-- package reference deletes its members (the app removes their images from
-- the RU bucket first; the cascade only drops rows). One member per content
-- line: unique on (parent_reference_id, item_type_id) — NULLs are distinct,
-- so regular items are not constrained by it.
--
-- Additive only: one nullable column, no data moves. Existing reference items
-- of package types become package references without members, and the opening
-- behaves as before for them. The previous image keeps working after it (it
-- never reads the column), so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read reference items.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "reference_items" ADD COLUMN IF NOT EXISTS "parent_reference_id" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reference_items_parent') THEN
        ALTER TABLE "reference_items"
            ADD CONSTRAINT "fk_reference_items_parent"
            FOREIGN KEY ("parent_reference_id") REFERENCES "reference_items"("reference_item_id") ON DELETE CASCADE ON UPDATE NO ACTION;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "reference_items_parent_type_uq" ON "reference_items"("parent_reference_id", "item_type_id");
