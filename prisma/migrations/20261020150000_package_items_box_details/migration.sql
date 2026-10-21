-- ============================================================================
-- items: a box's items still at the opening, with no serial yet, take the
-- box's details (its shipment line's certificate row).
--
-- WHY: intake used to give an item its template line's makat / model /
-- manufacturer / manufacturer number when the line had any, and the box's only
-- when it had none. Items now always take the box's (lib/packages/boxes.ts
-- intakeBox); the template names types, quantities and routes only. Boxes
-- taken in before that still carry the template's details on items the
-- opening has not recorded yet — this moves them to the box's.
--
-- Only items whose contents are not recorded yet: no serial (the opening
-- records serials and details together, PUT /api/packages/[id]/contents), in a
-- box still at its opening step (route step 1, not finished). A box without
-- any details of its own leaves its items as they are.
--
-- Data only, no schema change. No metrics_schema_version bump: the ledger
-- does not read item details.
--
-- Idempotent: a second run finds nothing left to move.
-- ============================================================================

UPDATE "items" AS i
   SET "makat"             = b."makat",
       "model"             = b."model",
       "manufacturer_name" = b."manufacturer_name",
       "manufacturer_no"   = b."manufacturer_no"
  FROM "items" AS b
  JOIN "item_routes" AS r ON r."item_id" = b."item_id"
 WHERE i."package_id" = b."item_id"
   AND b."package_id" IS NULL
   AND r."current_route_step" = 1
   AND r."is_finished" = false
   AND NULLIF(TRIM(COALESCE(i."serial_no", '')), '') IS NULL
   AND COALESCE(NULLIF(TRIM(b."makat"), ''), NULLIF(TRIM(b."model"), ''),
                NULLIF(TRIM(b."manufacturer_name"), ''), NULLIF(TRIM(b."manufacturer_no"), '')) IS NOT NULL
   AND (i."makat", i."model", i."manufacturer_name", i."manufacturer_no")
       IS DISTINCT FROM (b."makat", b."model", b."manufacturer_name", b."manufacturer_no");
