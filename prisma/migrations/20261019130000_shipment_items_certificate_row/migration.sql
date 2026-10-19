-- ============================================================================
-- shipment_items: the rest of the certificate row a line was scanned from.
--
-- WHY: a line scanned from the certificate's equipment table kept only the
-- makat, model, manufacturer and manufacturer number
-- (20261019120000_shipment_items_certificate_details). The row has more:
--   rowNum|manufacturerNo|manufacturerName|version|idfMakat|serialNum|batchSize|qtyToTest|orderNum
-- and all of it is kept now (src/app/lib/itemQrParser.ts):
--   cert_row_no     the row's number on the certificate (מס"ד)
--   serial_no       the row's serial — a row with one is a single unit
--   batch_size      גודל אצווה, as printed
--   qty_to_test     how many of the row come to be tested
--   purchase_order  the order number
--   cert_row_raw    the row exactly as in the barcode, whatever it holds
-- A line typed by hand leaves them NULL.
--
-- Additive only: six nullable columns, no data moves. The previous image keeps
-- working after it (it never reads them), so this runs any time before the
-- new image. No metrics_schema_version bump: the ledger does not read
-- shipment lines.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "cert_row_no" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "serial_no" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "batch_size" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "qty_to_test" INTEGER;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "purchase_order" TEXT;
ALTER TABLE "shipment_items" ADD COLUMN IF NOT EXISTS "cert_row_raw" TEXT;
