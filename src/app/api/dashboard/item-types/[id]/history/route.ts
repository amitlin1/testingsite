import { entityHistoryRoute } from "../../../_lib/entity-history-route";

export const GET = entityHistoryRoute({
  filter: "itemTypeId",
  finishedKey: "itemsFinished",
  badId: "Item Type ID is required",
  failure: "Internal Server Error",
});
