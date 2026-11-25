// The completion CURVE of a shipment is its own endpoint
// (stats/completion-history?shipmentId=N); it is not recomputed here.
import { entityHistoryRoute } from "../../../_lib/entity-history-route";

export const GET = entityHistoryRoute({
  filter: "shipmentId",
  finishedKey: "itemsFinished",
  badId: "Shipment ID is required",
  failure: "Internal Server Error",
});
