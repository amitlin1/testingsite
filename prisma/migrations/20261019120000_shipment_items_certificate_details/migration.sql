-- ============================================================================
-- shipment_items: the certificate row's model, manufacturer and manufacturer
-- number, next to the makat it already keeps.
--
-- WHY: a box is minted from its shipment line (lib/packages/boxes.ts) and its
-- items take their details from the box at intake, so the opening station no
-- longer types them. The line kept only the makat; the rest of the row
-- scanned from the certificate was dropped on save, so a box had no model or
-- manufacturer to pass on.
--
-- Additive only: three nullable columns, no data moves. The previous image
-- keeps working after it (it never reads them), so this runs any time before
-- the new image. No metrics_schema_version bump: the ledger does not read
-- shipment lines.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "model" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "manufacturer_name" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "manufacturer_no" TEXT;
