import { entityHistoryRoute } from "../../../_lib/entity-history-route";

export const GET = entityHistoryRoute({
  filter: "customerId",
  finishedKey: "finishedItems",
  badId: "Customer ID is required",
  failure: "Internal Server Error",
});
