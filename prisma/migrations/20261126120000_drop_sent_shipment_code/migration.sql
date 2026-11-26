-- ============================================================================
-- The outgoing shipment code is gone: a return (shipment_history) is known by
-- its shipment, date, sender and signature only. The return form no longer asks
-- for it, and the history groups one send's lines by its signature file.
--
-- DESTRUCTIVE: the codes already typed into past returns are deleted with the
-- column. The previous image writes the column (NOT NULL) on every return, so
-- run this together with the new image — between the two, returns fail.
-- Idempotent.
-- ============================================================================

ALTER TABLE "shipment_history" DROP COLUMN IF EXISTS "sent_shipment_code";
