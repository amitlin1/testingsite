import { DashboardFilters } from "@/types/dashboard";

/**
 * Builds URLSearchParams from dashboard filters.
 * Shared across all dashboard pages to avoid duplicating param-building logic.
 */
export function buildDashboardQueryParams(
  startDate: string,
  endDate: string,
  filters: DashboardFilters
): URLSearchParams {
  const params = new URLSearchParams();
  params.append("startDate", startDate);
  params.append("endDate", endDate);

  if (filters.customerId) params.append("customerId", filters.customerId.toString());
  if (filters.shipmentId) params.append("shipmentId", filters.shipmentId.toString());
  if (filters.itemSerial) params.append("itemSerial", filters.itemSerial);
  if (filters.itemId) params.append("itemId", filters.itemId.toString());
  if (filters.itemTypeId) params.append("itemTypeId", filters.itemTypeId.toString());
  if (filters.testStationId) params.append("testStationId", filters.testStationId.toString());
  if (filters.testStationTypeId) params.append("testStationTypeId", filters.testStationTypeId.toString());
  if (filters.workerId) params.append("workerId", filters.workerId);
  if (filters.status && filters.status !== "all") params.append("status", filters.status);
  // §5.0(1): ONE parameter carries the shipment scope, and it is always sent —
  // an absent scope is a default the reader cannot see. `showAllHistory` was the
  // flag spelling of this same choice (the routes still accept it for bookmarked
  // URLs) and `showSent` was a second spelling that no route ever read, which is
  // why the toggle bound to it did nothing.
  params.append("scope", filters.showAllHistory ? "all" : "open_shipments");

  return params;
}
