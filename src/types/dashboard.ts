/**
 * TypeScript types for Dashboard data structures
 */

export interface DashboardKpis {
  averageQueueTimeMinutes: number | null;
  averageProcessingTimeMinutes: number | null;
  totalItemsProcessed: number;
  itemsCurrentlyInQueue: number;
  itemsCurrentlyInTest: number;
  busiestStationId: number | null;
  busiestStationName: string | null;
  busiestStationCount: number;
  busiestStationWorkloadScore?: number;
  busiestStationBusySeconds?: number;
  busiestStationWaitSeconds?: number;
  avgQueueSeconds?: number;
  avgProcessingSeconds?: number;
  treatedCount?: number;
}

export interface StationLoadRow {
  stationId: number;
  stationName: string;
  stationTypeName: string | null;
  itemsInQueue: number;
  itemsInTest: number;
  averageCurrentQueueTimeMinutes: number | null;
  totalProcessedInPeriod: number;
}

export interface SlowItemRow {
  itemId: number;
  serialNo: number;
  makat: number;
  model: string;
  stationName: string | null;
  routeStep: number;
  queueTimeMinutes: number | null;
  processingTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  workerId: number | null;
}

export interface ShipmentTrackingRow {
  shipmentId: number;
  shipmentCode: string;
  shipmentDate: string;
  customerCode: string;
  customerName: string;
  totalItems: number;
  itemsInQueue: number; // status = 2
  itemsInTest: number; // status = 1
  itemsWaitingForResearch: number; // status = 4
  itemsInResearch: number; // status = 5
  itemsFinished: number; // status = 3
  itemsInRoutes: number; // כל הפריטים שיש להם רשומה ב-item_routes
  // `| null` is the wire contract, not a convenience: Q7 answers NULL when the
  // denominator is 0 (nothing routed / nothing declared), and the routes stopped
  // coercing that to a real 0. Typed honestly here so a renderer has to decide
  // what "no answer" looks like instead of printing the string "null%".
  completionPercentage: number | null;
  itemsInRoutesPercentage: number | null; // itemsInRoutes / totalItems
}

export interface ItemTypeTrackingRow {
  itemTypeId: number;
  itemTypeDesc: string;
  totalItems: number;
  itemsInQueue: number; // status = 2
  itemsInTest: number; // status = 1
  itemsWaitingForResearch: number; // status = 4
  itemsInResearch: number; // status = 5
  itemsFinished: number; // status = 3
  itemsInRoutes: number; // כל הפריטים שיש להם רשומה ב-item_routes
  completionPercentage: number | null;
  itemsInRoutesPercentage: number | null; // itemsInRoutes / totalItems
}

export interface StatusDistribution {
  status: string;
  statusName: string;
  count: number;
  percentage: number;
}

export interface CustomerPerformanceRow {
  customerId: number;
  customerCode: string;
  customerName: string;
  totalItems: number;
  itemsInQueue: number; // status = 2
  itemsInTest: number; // status = 1
  itemsWaitingForResearch: number; // status = 4
  itemsInResearch: number; // status = 5
  finishedItems: number; // status = 3
  itemsInRoutes: number; // כל הפריטים שיש להם רשומה ב-item_routes
  successPercentage: number | null; // finishedItems / itemsInRoutes
  itemsInRoutesPercentage: number | null; // itemsInRoutes / totalItems
  averageTimeMinutes: number | null;
}

export interface AverageTimesPoint {
  date: string; // YYYY-MM-DD
  avgWaitingMinutes: number | null;
  avgProcessingMinutes: number | null;
  recordCount: number;
  isToday?: boolean;
}

export type AverageTimesPeriod = "daily" | "monthly" | "quarterly";

export interface Option {
  id: string | number;
  name: string;
  count?: number;
  color?: string;
  icon?: React.ReactNode;
}

export interface CustomerOption {
  id: number;
  name: string;
  code: string;
}

export type DateRangePreset = "today" | "last7days" | "last30days" | "custom";

export type StatusFilter = "all" | "queue" | "processing" | "finished";

export interface DashboardFilters {
  customerId: number | null;
  shipmentId: number | null;
  itemSerial: string | null; // keeping as string for flexible input, will parse to int in API if numeric
  itemId: number | null; // Direct Item ID filter
  itemTypeId: number | null;
  testStationId: number | null;
  testStationTypeId: number | null;
  workerId: string | null; // numeric input but handled as text
  status: StatusFilter;
  /** "Show completed shipments" — sent on the wire as scope=all|open_shipments. */
  showAllHistory?: boolean;
}
