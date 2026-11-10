-- ============================================================================
-- Two signatures on an item report (docs/ITEM_REPORTS.md):
--
--   the closing signature  given at the kit's closing, in the closing template's
--                          "חתימה על הדוחות" step, before "סגור מארז". It is
--                          printed in the report but does not lock it.
--   the final signature    the approver's, on the item's history page — the
--                          existing signature_* columns. It locks the report.
--
-- The closing signature gets columns of its own on item_reports, in the shape of
-- the final one's, and is valid only for the finish it was given for
-- (closing_signed_finished_at = item_routes.finished_at), so reopening an item
-- needs no cleanup here either.
--
-- Additive only: six nullable columns, nothing existing changes. The previous
-- image never reads them, so this runs any time before the new image. No
-- metrics_schema_version bump: the ledger does not read them.
--
-- Idempotent: the air-gap procedure re-runs migration files against an
-- already-migrated database.
-- ============================================================================

ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signature_key"      VARCHAR(1024);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by"          VARCHAR(255);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by_name"     TEXT;
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_by_number"   VARCHAR(64);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_at"          TIMESTAMPTZ(6);
ALTER TABLE "item_reports" ADD COLUMN IF NOT EXISTS "closing_signed_finished_at" TIMESTAMP(6);
