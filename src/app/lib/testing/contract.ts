import type { PackageView } from "@/app/lib/packages/contract";

/**
 * The testing station flow's wire contract: what the testing screen, the station popups and the
 * /api/testing/* routes exchange. Client-safe: no prisma, no server import. The routes build their
 * answers as these types; the client reads them through src/app/testing/api.ts.
 */

// ---- stations --------------------------------------------------------------------------------

/** A station as a popup gets it. */
export type TestStation = {
  test_station_id: number;
  test_station_desc: string;
  test_station_type_id: number;
};

/** One station type of GET /api/testing/stations. */
export interface TestStationType {
  id: number;
  name: string;
  /** Opening / closing station type: the queue holds packages, not items. */
  packageLevel?: boolean;
  /** Its popup template (docs/features/popup-templates/PLAN.md §3.6); null = the code's popup. */
  popupTemplate?: { base: string; version: number } | null;
}

/** A station of GET /api/stations (the testing dock's all-stations picker). */
export type StationLite = { id: number; name: string; typeId: number };

// ---- the queue -------------------------------------------------------------------------------

/** A row of a station's queue (GET /api/testing/items): the item's route and the item. */
export type QueueRow = {
  item_id: number;
  serial_no: string | null;
  item_type_id: number | null;
  item_type_desc: string | null;
  /** Package model (docs/features/packages/PLAN.md): this row IS a box — package-level queues list these. */
  is_package?: boolean;
  /** Position inside the box (01..99) when this row is an item in one. */
  package_seq?: number | null;
  /** The box: its own view for a box row, the parent's view for an item inside one (siblings,
   *  states, blockers). null for a loose item. */
  package?: PackageView | null;
  package_id: number | null;
  current_status: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  processing_start_time: string | null;
  queue_start_time: string | null;
  route_steps: number[] | null;
  route_number: number | null;
  test_station_id: number | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  customer_id: number | null;
  customer_code: string | null;
  customer_name?: string | null;
  shipment_id: number | null;
  shipment_code: string | null;
  makat: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  model: string | null;
  /** The manufacturer SKU the item was last scanned with at a station (its reference item's) —
   *  the next station's SKU scan starts from it. */
  last_sku?: string | null;
  /** Who started the test now running (the ledger's test_started event); null while waiting. */
  in_test_worker_name?: string | null;
};

/** One row of GET /api/testing/shipment-progress: a shipment's items that pass this station's
 *  type (the station's level: boxes at an opening / closing station, items elsewhere), and how
 *  many of them are already past it. */
export type ShipmentProgress = {
  shipmentId: number;
  shipmentCode: string | null;
  /** When the shipment was entered (received_at, else its certificate date); UTC ISO. */
  receivedAt: string | null;
  /** Rows of the shipment whose route has a step of this station's type. */
  total: number;
  /** Of those: the route finished, or the current step is past the last step of this type. */
  done: number;
};

/** GET /api/testing/completed-today. */
export type CompletedTodayAnswer = { count: number };

/** A row of GET /api/testing/station-history (the station's last 100 results). */
export type StationHistoryRow = {
  logId: number;
  itemId: number;
  currentRouteStep: number;
  testStationId: number;
  queueStartTime: string | null;
  processingStartTime: string | null;
  processingEndTime: string | null;
  /** Net (working-hours) seconds from processing start to end; null while running or with no calendar. */
  netWorkSeconds: number | null;
  workerId: number | null;
  serialNo: string | null;
  makat: string;
  model: string;
  manufacturerName: string;
  manufacturerNo: string;
  itemTypeDesc: string | null;
};

// ---- a result: POST /api/testing/results -----------------------------------------------------

/** What a popup reports back on submit; the page adds the row's identity (ResultBody). */
export type TestResultData = {
  Result: number;
  Comments?: string;
  WorkerID?: number;
  sendToResearch?: boolean;
  /** Research: back to the route at the same step (5→2). */
  returnToRoute?: boolean;
  /** Research: the route ends here (5→3). */
  finishRoute?: boolean;
  /** Overall pass/fail (the station-type popups). */
  Passed?: boolean;
  /** The station type's structured payload → test_results.details. */
  Details?: unknown;
  /** Client action UUID (§4.4). Popups that keep an error-retry path set it themselves (same id
   *  on retry ⇒ ledger replay, not a duplicate event); the page mints one per call otherwise. */
  SubmitID?: string;
};

/** The body of POST /api/testing/results. The route fills an omitted step / timing field from the
 *  item's route row (a wizard's per-item results send none of them). */
export type ResultBody = TestResultData & {
  ItemID: number;
  StationID: number;
  CurrentRouteStep?: number | null;
  RouteStepsLength?: number;
  QueueStartTime?: string | null;
  ProcessingStartTime?: string | null;
  ItemTypeId?: number | null;
  CreatedAt?: string | null;
  /** Snapshot of the acting worker's display name for the metrics ledger. */
  WorkerName?: string;
  /** The closing's report signature, a PNG data URL (docs/features/ITEM_REPORTS.md). */
  ReportSignature?: string;
};

/** The station picked for the item's next route step. */
export type NextStation = {
  testStationId: number;
  testStationDesc: string;
  stationTypeId: number;
  routeStep: number;
};

/** Where an item goes after a result: the station picked for its next route step, or the end of
 *  its route. Neither (a replay that could not read the item, a research send) = unknown. */
export type NextStationResult = {
  isLastStation?: boolean;
  nextStation?: NextStation;
};

/** The research station an item sent to research was assigned to. */
export type ResearchStation = {
  stationId: number;
  stationDesc: string;
  stationTypeId: number;
  stationTypeName: string;
  currentLoad: number;
};

/** The box gate after the result (docs/features/packages/PLAN.md §4). */
export type PackageGateAnswer = { packageId: string; status: number | null; blockingItemIds: string[] };

/** The answer of POST /api/testing/results. */
export type ResultAnswer = NextStationResult & {
  ok: true;
  success: true;
  /** A recognised retry of a submit that already committed: nothing was written this time. */
  replay?: true;
  researchId?: number | null;
  logId?: number | null;
  isLastStep?: false;
  recommendedResearchStation?: ResearchStation;
  packageGate?: PackageGateAnswer;
  /** The report signing that came with the result (ReportSignature). */
  reportSign?: "signed" | "nothing_to_sign" | "failed";
};

// ---- start, release, step back, locate -------------------------------------------------------

/** Actor of a start / release: `actionUuid` keys the ledger event (§4.4). */
export type StartReleaseBody = {
  itemId: number;
  stationId: number;
  actionUuid: string;
  workerId?: number;
  workerName?: string;
};

/** What start-test answers as `item`: the row it started. */
export type StartedRow = {
  item_id: string;
  current_status: number;
  processing_start_time: string | null;
  test_station_id: number | null;
  current_route_step: number;
  /** A box's items started with it (the group start). */
  startedPackageItems: string[];
};

/** The answer of POST /api/testing/start-test. */
export type StartTestAnswer = { ok: true; item: StartedRow };
/** The answer of POST /api/testing/release-test. */
export type ReleaseTestAnswer = { ok: true };

/** The body of POST /api/testing/step-back. */
export type StepBackBody = {
  itemId: string;
  currentRouteStep: number;
  /** Why the item goes back — required; printed on its report. */
  reason: string;
  workerId?: number;
  workerName?: string;
  actionId: string;
};

/** The answer of POST /api/testing/step-back. */
export type StepBackAnswer = {
  itemId: string;
  routeStep: number;
  stationTypeId: number;
  stationTypeDesc: string;
  stationId: number | null;
  stationDesc: string | null;
  /** The box's closing was open and stopped (the wizard closes). */
  closingStopped: boolean;
};

/** What GET /api/testing/locate-by-barcode answers for a scanned label. `legacyId` /
 *  `resolvedItemId` when the label is a pre-upgrade one resolved through legacy_id_map. */
export type LocateAnswer = {
  itemId: number;
  serialNo: string | null;
  makat: string | null;
  model: string;
  legacyId?: number;
  resolvedItemId?: number;
} & (
  | { finished: true }
  | { waitingForPackageItems: true; currentStatus: number; stationTypeId: number | null; blockingItemIds: number[] }
  | { currentStatus: number; stationId: number; stationTypeId: number }
);
