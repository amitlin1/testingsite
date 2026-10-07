-- ============================================================================
-- package_contents: drop manufacturer_sku.
--
-- WHY: the opening wizard used to find each item's reference item through a
-- manufacturer SKU typed into the package template. That value was frozen onto
-- items.template_snapshot when the box was created, so fixing the template
-- never reached a box that already existed, and an empty cell meant "no
-- reference" with nothing on screen saying why. The wizard now finds the
-- reference item from what the worker SCANS: the box label against the
-- package type's reference items, each item's label against its own type's.
-- The template no longer carries a SKU at all.
--
-- Old snapshots keep a "manufacturer_sku" key inside their JSON; nothing reads
-- it any more, so they are left as they are.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "package_contents" DROP COLUMN IF EXISTS "manufacturer_sku";
