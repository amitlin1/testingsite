/**
 * Helper to build SQL WHERE conditions for dashboard filters.
 */

export interface FilterConfig {
  searchParams: URLSearchParams;
  startIndex?: number;
  itemRef?: string; // e.g. "irh.item_id"
  stationRef?: string; // e.g. "irh.test_station_id"
  workerRef?: string | null; // e.g. "irh.worker_id", or null to disable worker filter
  statusRef?: string | null; // e.g. "ir.current_status", mostly for item_routes
  showAllHistory?: boolean;
}

export interface FilterResult {
  conditions: string;
  params: any[];
  nextIndex: number;
}

/**
 * Builds filter conditions for dashboard queries.
 */
export function buildDashboardFilters({
  searchParams,
  startIndex = 1,
  itemRef = "item_id",
  stationRef = "test_station_id",
  workerRef = "worker_id",
  statusRef = "current_status", // default if not provided, assuming likely item_routes context or similar
  showAllHistory = false,
}: FilterConfig): FilterResult {
  const conditions: string[] = [];
  const params: any[] = [];
  let currentIndex = startIndex;

  // Helper to add condition
  const addCondition = (clause: string, value: any) => {
    conditions.push(clause.replace(/\$\?/g, `$${currentIndex}`));
    params.push(value);
    currentIndex++;
  };

  // 1. Customer Filter
  const customerId = searchParams.get("customerId");
  if (customerId) {
    addCondition(
      `AND EXISTS (SELECT 1 FROM items i_filter WHERE i_filter.item_id = ${itemRef} AND i_filter.customer_id = $?::int)`,
      parseInt(customerId, 10)
    );
  }

  // 2. Shipment Filter
  const shipmentId = searchParams.get("shipmentId");
  if (shipmentId) {
    addCondition(
      `AND EXISTS (SELECT 1 FROM items i_filter WHERE i_filter.item_id = ${itemRef} AND i_filter.shipment_id = $?::int)`,
      parseInt(shipmentId, 10)
    );
  }

  const itemSerial = searchParams.get("itemSerial");
  if (itemSerial) {
    addCondition(
      `AND EXISTS (SELECT 1 FROM items i_filter WHERE i_filter.item_id = ${itemRef} AND i_filter.serial_no = $?)`,
      itemSerial
    );
  }

  // 4. Item Type
  const itemTypeId = searchParams.get("itemTypeId");
  if (itemTypeId) {
    addCondition(
      `AND EXISTS (SELECT 1 FROM items i_filter WHERE i_filter.item_id = ${itemRef} AND i_filter.item_type_id = $?::int)`,
      parseInt(itemTypeId, 10)
    );
  }

  // 5. Station
  const testStationId = searchParams.get("testStationId");
  if (testStationId) {
    addCondition(`AND ${stationRef} = $?::int`, parseInt(testStationId, 10));
  }

  // 6. Station Type
  const testStationTypeId = searchParams.get("testStationTypeId");
  if (testStationTypeId) {
    addCondition(
      `AND EXISTS (SELECT 1 FROM test_stations ts_filter WHERE ts_filter.test_station_id = ${stationRef} AND ts_filter.test_station_type_id = $?::int)`,
      parseInt(testStationTypeId, 10)
    );
  }

  // 7. Worker
  if (workerRef) {
    const workerId = searchParams.get("workerId");
    if (workerId && !isNaN(Number(workerId))) {
      addCondition(`AND ${workerRef} = $?::int`, parseInt(workerId, 10));
    }
  }

  // 8. Show All History (Active Shipments Only Filter)
  // If showAllHistory is FALSE (default), we only show items from ACTIVE shipments (shipments.is_sent = false)
  // NOTE: This does NOT filter by item_routes.is_finished or current_status.
  // The item can be finished (completed its route) and still be shown if its shipment is active.
  if (!showAllHistory) {
    conditions.push(`AND EXISTS (
        SELECT 1 
        FROM items i_fs 
        JOIN shipments s_fs ON i_fs.shipment_id = s_fs.id 
        WHERE i_fs.item_id = ${itemRef} AND s_fs.is_sent = false
     )`);
  }

  return {
    conditions: conditions.join(" "),
    params,
    nextIndex: currentIndex
  };
}
