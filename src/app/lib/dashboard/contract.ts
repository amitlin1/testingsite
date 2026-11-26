// The dashboard's wire contract: what every /api/dashboard route serialises,
// the response headers they set, and one adapter per endpoint that turns a wire
// row into what the screens render. Client-safe — no prisma, no server import.
//
// The ledger rewrite shipped its additions under a `_new_` prefix. Nothing
// outside this file reads a `_new_` name: the adapters strip it, so dropping the
// prefix upstream is a change to this file alone.
//
// Nothing here turns a null into a zero. `null` is the answer "no denominator"
// or "nothing was measured", and the screens print it as an em dash.

// ---------------------------------------------------------------------------
// Headers and request vocabulary
// ---------------------------------------------------------------------------

/** What the server actually queried. Absent headers mean the clamp did not fire. */
export const METRICS_HEADER = {
  periodFrom: "X-Metrics-Period-From",
  periodTo: "X-Metrics-Period-To",
  granularity: "X-Metrics-Period-Granularity",
  scope: "X-Metrics-Scope",
  /** The 13-month UI cap (§6.3) moved the start. */
  capped: "X-Metrics-Period-Capped",
  requestedFrom: "X-Metrics-Period-Requested-From",
  capFloor: "X-Metrics-Period-Cap-Floor",
  /** The request reached into the future and the end was pulled back to today. */
  clampedEnd: "X-Metrics-Period-Clamped-End",
  requestedTo: "X-Metrics-Period-Requested-To",
  /** `source:filter` pairs, comma-separated — a filter some part of the answer could not honour. */
  ignoredFilters: "X-Metrics-Ignored-Filters",
} as const;

/** The dashboard's filter query parameters: the names the client writes
 *  (dashboard/tests/_lib/filters.ts) and filtersFromSearchParams reads. `scope`
 *  is `all` or `open_shipments`; `packagesOnly=true` is read by the server only. */
export const FILTER_PARAM = {
  customerId: "customerId",
  shipmentId: "shipmentId",
  itemTypeId: "itemTypeId",
  stationId: "testStationId",
  stationTypeId: "testStationTypeId",
  workerId: "workerId",
  itemSerial: "itemSerial",
  status: "status",
  scope: "scope",
  packagesOnly: "packagesOnly",
} as const;

/** The part of a response that cannot honour a filter — the left half of an
 *  `X-Metrics-Ignored-Filters` entry. */
export type MetricsSource =
  | "liveBoard"
  | "entityProgress"
  | "finishedCumulative"
  | "workThroughput"
  | "completionSeries"
  | "totalItemsProcessed";

/** §6.3 — no dashboard window reaches further back than this many calendar months. */
export const UI_MONTH_CAP = 13;

/** The `period` of the four history dialogs: a window in months back from today.
 *  `alldays` is the whole window the cap allows; `3years` is requested as such
 *  and capped by the server (and the cap reported). */
export const HISTORY_PRESET_MONTHS = { alldays: UI_MONTH_CAP, "12months": 12, "3years": 36 } as const;
export type HistoryPreset = keyof typeof HISTORY_PRESET_MONTHS;

export function isHistoryPreset(v: unknown): v is HistoryPreset {
  return typeof v === "string" && Object.keys(HISTORY_PRESET_MONTHS).includes(v);
}

// ---------------------------------------------------------------------------
// Wire shapes — exactly what each route serialises
// ---------------------------------------------------------------------------

/** GET tests/kpis */
export interface KpisWire {
  averageQueueTimeMinutes: number | null;
  averageProcessingTimeMinutes: number | null;
  avgQueueSeconds: number | null;
  avgProcessingSeconds: number | null;
  /** Route runs closed in the window (§5.3ב) — `treatedCount` is the same number. */
  totalItemsProcessed: number;
  treatedCount: number;
  itemsCurrentlyInQueue: number;
  itemsCurrentlyInTest: number;
  busiestStationId: number | null;
  busiestStationName: string | null;
  /** Steps processed at the busiest station (§5.10 replaced the workload score). */
  busiestStationCount: number;
  busiestStationBusySeconds: number;
  /** The busiest station's TYPE queue, work clock; 0 when that type closed no wait. */
  busiestStationWaitSeconds: number;
  _new_averageQueueWorkMinutes: number | null;
  _new_averageProcessingWorkMinutes: number | null;
  /** §5.10 kpi_offhours_minutes — the window TOTAL of wall minus work. */
  _new_offhoursMinutes: number | null;
  _new_researchWaitWallMinutes: number | null;
  _new_researchWaitWorkMinutes: number | null;
  _new_researchWallMinutes: number | null;
  _new_researchWorkMinutes: number | null;
  _new_waitRecordCount: number;
  _new_busyRecordCount: number;
  _new_unitsTouched: number;
  _new_busiestStationWorkHours: number | null;
  _new_busiestStationWallHours: number | null;
  _new_busiestStationStepsProcessed: number | null;
  _new_busiestStationTypeId: number | null;
  /** The wall twin of busiestStationWaitSeconds; NULL when the type closed no wait. */
  _new_busiestStationWaitWallSeconds: number | null;
  /** The lab-wide waiting total, under its own name so it is never read as the busiest station's. */
  _new_labWaitWorkSeconds: number;
  _new_labWaitWallSeconds: number;
  /** Qualified names, comma-separated; null when every filter was honoured. */
  _new_ignoredFilters: string | null;
}

/** GET tests/by-station — Q3 (the live board, lab-wide) + Q4 (the window). */
export interface StationWire {
  stationId: number;
  stationName: string;
  stationTypeName: string | null;
  /** The station TYPE's shared queue. Repeats across a type; never summed. */
  itemsInQueue: number;
  itemsInTest: number;
  /** Mean age of who is waiting for the type now (state, not flow). */
  averageCurrentQueueTimeMinutes: number | null;
  totalProcessedInPeriod: number;
  _new_itemsInResearch: number;
  /** Station-less; the same number on every row. */
  _new_researchPoolQueue: number;
  _new_standingQueueAgeWorkMinutes: number | null;
  _new_oldestQueueAgeWallMinutes: number | null;
  _new_oldestQueueAgeWorkMinutes: number | null;
  _new_p95QueueAgeWallMinutes: number | null;
  _new_p95QueueAgeWorkMinutes: number | null;
  _new_activeTestAgeWallMinutes: number | null;
  _new_activeTestAgeWorkMinutes: number | null;
  _new_operations: number;
  _new_stepsCompleted: number;
  _new_divertedToResearch: number;
  _new_returnedFromResearch: number;
  _new_abandonments: number;
  _new_reworkSteps: number;
  _new_restartsAfterAbandonment: number;
  _new_manualEntries: number;
  /** The duration denominator: accessories excluded (§5.0(8)), so not steps processed. */
  _new_durationRecordCount: number;
  _new_avgBusyWallMinutes: number | null;
  _new_avgBusyWorkMinutes: number | null;
  _new_busyWallHours: number | null;
  _new_busyWorkHours: number | null;
  _new_p95WallMinutes: number | null;
  _new_p95WorkMinutes: number | null;
  _new_maxWallMinutes: number | null;
  _new_maxWorkMinutes: number | null;
  /** Closed waits of the station's TYPE in the window — repeat across a type. */
  _new_typeWaitWallHours: number | null;
  _new_typeWaitWorkHours: number | null;
  _new_typeWaitAvgWallMinutes: number | null;
  _new_typeWaitAvgWorkMinutes: number | null;
}

/** GET tests/slow-items — Q6, ordered by the work clock. */
export interface SlowItemWire {
  itemId: number;
  serialNo: string | null;
  makat: string | null;
  model: string;
  stationName: string | null;
  /** The step that was slow, not the item's current one. */
  routeStep: number;
  workerId: number | null;
  queueTimeMinutes: number | null;
  processingTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  _new_attemptNo: number;
  /** The opening event's reason of the slow interval. */
  _new_entryReason: string;
  _new_workerName: string | null;
  /** The owner at the time of the step, never the item's current owner. */
  _new_customerId: number | null;
  _new_customerName: string | null;
  _new_queueWorkMinutes: number | null;
  _new_processingWorkMinutes: number | null;
  _new_totalWorkMinutes: number | null;
}

/** GET tests/shipments — Q7 by shipment. No window: a state query. */
export interface ShipmentWire {
  shipmentId: number;
  shipmentCode: string;
  shipmentDate: string | null;
  customerCode: string;
  customerName: string;
  /** The declared amount — displayed, never divided into. */
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  itemsFinished: number;
  itemsInRoutes: number;
  /** finished_runs / routed_runs; NULL when nothing is routed. */
  completionPercentage: number | null;
  /** Coverage: routed units / declared amount; NULL when nothing was declared. */
  itemsInRoutesPercentage: number | null;
  _new_routedUnits: number;
  _new_finishedRuns: number;
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
  /** Receipt to despatch, from `shipments` — a different measurement from the route turnaround. */
  _new_shipTurnaroundWallMinutes: number | null;
  _new_shipTurnaroundWorkMinutes: number | null;
  /** Unqualified entityProgress names; the header carries the qualified list. */
  _new_ignoredFilters: string | null;
}

/** GET tests/customer-performance — Q7 by customer + Q4 over the window. */
export interface CustomerWire {
  customerId: number;
  customerCode: string;
  customerName: string;
  /** count(DISTINCT unit_id) of the customer's routed runs. */
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  finishedItems: number;
  itemsInRoutes: number;
  /** COMPLETION (finished_runs / routed_runs) under its legacy name; NULL when nothing is routed. */
  successPercentage: number | null;
  itemsInRoutesPercentage: number | null;
  /** Route turnaround, wall clock. */
  averageTimeMinutes: number | null;
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  _new_averageTimeWorkMinutes: number | null;
  _new_windowStepsProcessed: number;
  _new_windowAvgProcessingWallMinutes: number | null;
  _new_windowAvgProcessingWorkMinutes: number | null;
  _new_windowAvgWaitWallMinutes: number | null;
  _new_windowAvgWaitWorkMinutes: number | null;
}

/** GET tests/item-types — Q7 by item type; counted in route runs, never units. */
export interface ItemTypeWire {
  itemTypeId: number;
  itemTypeDesc: string;
  /** The routed population (route runs), not SUM(amount). */
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  itemsFinished: number;
  itemsInRoutes: number;
  completionPercentage: number | null;
  itemsInRoutesPercentage: number | null;
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
}

/** GET tests/average-times — Q4 buckets by close day/month/quarter. */
export interface AverageTimesWire {
  date: string;
  /** Present (true) only on today's bucket of the daily view. */
  isToday?: true;
  avgWaitingMinutes: number | null;
  avgProcessingMinutes: number | null;
  /** The processing denominator — accessories excluded. */
  recordCount: number;
  _new_avgWaitingWorkMinutes: number | null;
  _new_avgProcessingWorkMinutes: number | null;
  /** Per-bucket average of wall minus work (tests/kpis reports the window total). */
  _new_avgOffhoursMinutes: number | null;
  _new_p95WaitingWallMinutes: number | null;
  _new_p95WaitingWorkMinutes: number | null;
  _new_p95ProcessingWallMinutes: number | null;
  _new_p95ProcessingWorkMinutes: number | null;
  /** The waiting denominator — accessories kept. */
  _new_waitRecordCount: number;
  _new_stepsProcessed: number;
}

/** GET tests/status-distribution — Q1, the ACTIVE population at the window's end. */
export interface StatusWire {
  /** The legacy numeric status id, or the state key for a state without one. */
  status: string;
  /** metric_state.label_he */
  statusName: string;
  count: number;
  percentage: number;
  _new_stateKey: string;
  _new_units: number;
  /** The instant probed. */
  _new_asOf: string;
}

export interface StatusHistoryEntryWire {
  status: string;
  statusName: string;
  count: number;
  /** null on the cumulative entry: a running total has no share of a snapshot. */
  percentage: number | null;
  _new_stateKey: string;
  _new_series: "point_in_time" | "cumulative";
}

/** GET tests/status-distribution/history — Q2א per day, Q2ב and Q2ג beside it. */
export interface StatusHistoryWire {
  date: string;
  statuses: StatusHistoryEntryWire[];
  isToday: boolean;
  /** Route-run closures to date — the same number as the `done` entry. */
  finishedCumulative: number;
  /** Closures on this day alone, every run (accessories included). */
  _new_finishedToday: number;
  /** The throughput PAIR (Q2ג) — one population, accessories excluded from both. */
  _new_workStartedToday: number;
  _new_workFinishedToday: number;
  /** Sum of the active states — the percentage denominator. */
  _new_activeTotal: number;
}

/** GET stations/[id]/history — the only dialog series that carries a clock pair. */
export interface StationHistoryWire {
  date: string;
  isToday: boolean;
  /** State `testing` held by this station. */
  itemsInTest: number;
  _new_inResearch: number;
  /** Waiting for this station's TYPE — shared with every station of the type. */
  _new_sharedTypeQueue: number;
  _new_unmapped: number;
  /** Q4 steps processed that day — not `result_submitted` alone. */
  totalProcessed: number;
  _new_waitSamples: number;
  _new_handleSamples: number;
  /** NULL when nothing closed that day. */
  _new_waitWallMin: number | null;
  _new_waitWorkMin: number | null;
  _new_handleWallMin: number | null;
  _new_handleWorkMin: number | null;
}

interface EntityHistoryWireBase {
  date: string;
  isToday: boolean;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  _new_unmapped: number;
  _new_activeTotal: number;
  _new_finishedToday: number;
  /** Boxes waiting before their closing step. Shipped, not drawn (bug B-12). */
  _new_waiting_for_package_items: number;
}

/** GET {customers,shipments,item-types}/[id]/history — counts only. The
 *  cumulative closures are `finishedItems` on the customer route and
 *  `itemsFinished` on the other two. */
export type EntityHistoryWire = EntityHistoryWireBase & ({ finishedItems: number } | { itemsFinished: number });

/**
 * GET stats/completion-history — one object per sampled day. Every key that is
 * not `date` and does not start with `_new_` is a SHIPMENT CODE whose value is
 * the completion ratio as a one-decimal string; `_new_counts` holds the two
 * numbers behind each ratio.
 */
export interface CompletionHistoryWire {
  date: string;
  _new_counts: Record<string, { routed: number; finished: number }>;
  [shipmentCode: string]: string | Record<string, { routed: number; finished: number }>;
}

/**
 * GET summary — the managers' one-screen summary (/dashboard). `period` is the
 * window served (X-Metrics-Period-* say the same); `now` ignores it. Every
 * definition is in lib/metrics/read/summary.ts.
 */
export interface SummaryWire {
  period: {
    shipmentsIn: number;
    shipmentsOut: number;
    boxesIn: number;
    boxesOut: number;
    /** Items (never boxes) whose route closed in the window, by the report's overall verdict. */
    itemsPassed: number;
    itemsFailed: number;
    /** Closed with no decided step: in neither percentage. */
    itemsUndecided: number;
    /** One decimal, over passed + failed; null when no item has a verdict. */
    passPct: number | null;
    failPct: number | null;
    /** Boxes whose route closed in the window, and the ones both clocks could measure. */
    boxesFinished: number;
    boxesTimed: number;
    /** Seconds: average opened → closed per box, over the SAME `boxesTimed` runs on both clocks. */
    routeTime: ClockPair;
  };
  now: {
    /** When the state was read. */
    asOf: string;
    shipmentsInWork: number;
    shipmentsReady: number;
    itemsTotal: number;
    itemsWaiting: number;
    itemsInWork: number;
    itemsInResearch: number;
    itemsReady: number;
  };
}

// ---------------------------------------------------------------------------
// Views — what the screens render
// ---------------------------------------------------------------------------

type Unprefixed<T> = { [K in keyof T as K extends `_new_${infer R}` ? R : K]: T[K] };

function unprefix<T extends object>(row: T): Unprefixed<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.startsWith("_new_") ? key.slice(5) : key] = value;
  return out as Unprefixed<T>;
}

export type KpisView = Unprefixed<KpisWire>;
export type SlowItemView = Unprefixed<SlowItemWire>;
export type ShipmentView = Unprefixed<ShipmentWire>;
export type CustomerView = Unprefixed<CustomerWire>;
export type ItemTypeView = Unprefixed<ItemTypeWire>;
export type AverageTimesView = Unprefixed<AverageTimesWire>;
export type StatusView = Unprefixed<StatusWire>;

export type StationView = Unprefixed<StationWire> & {
  /** Closed waits of the station's type in the window. The route ships the
   *  type's total hours and their average, and both come from the same filtered
   *  rows (one FILTER governs count, avg and sum in Q4), so hours / average is
   *  the exact count. NULL when the type closed no wait. */
  typeWaitRecordCount: number | null;
};

export type StatusHistoryView = Omit<Unprefixed<StatusHistoryWire>, "statuses"> & {
  statuses: Array<Unprefixed<StatusHistoryEntryWire>>;
};

export const adaptKpis = (wire: KpisWire): KpisView => unprefix(wire);
export const adaptSlowItems = (wire: SlowItemWire[]): SlowItemView[] => wire.map(unprefix);
export const adaptShipments = (wire: ShipmentWire[]): ShipmentView[] => wire.map(unprefix);
export const adaptCustomers = (wire: CustomerWire[]): CustomerView[] => wire.map(unprefix);
export const adaptItemTypes = (wire: ItemTypeWire[]): ItemTypeView[] => wire.map(unprefix);
export const adaptAverageTimes = (wire: AverageTimesWire[]): AverageTimesView[] => wire.map(unprefix);
export const adaptStatus = (wire: StatusWire[]): StatusView[] => wire.map(unprefix);

export function adaptStations(wire: StationWire[]): StationView[] {
  return wire.map((row) => {
    const hours = row._new_typeWaitWallHours;
    const avg = row._new_typeWaitAvgWallMinutes;
    return {
      ...unprefix(row),
      typeWaitRecordCount: hours === null || avg === null || avg <= 0 ? null : Math.round((hours * 60) / avg),
    };
  });
}

export function adaptStatusHistory(wire: StatusHistoryWire[]): StatusHistoryView[] {
  return wire.map((day) => ({ ...unprefix(day), statuses: day.statuses.map(unprefix) }));
}

/** What the live board says about the lab as a whole. */
export interface BoardSummary {
  /** Station-less and identical on every row, so read once; null with no rows. */
  researchPool: number | null;
  inResearch: number;
  /** Stations holding at least one item in test or in research. */
  activeStations: number;
}

export function boardSummary(rows: StationView[]): BoardSummary {
  return {
    researchPool: rows.length > 0 ? rows[0].researchPoolQueue : null,
    inResearch: rows.reduce((sum, row) => sum + row.itemsInResearch, 0),
    activeStations: rows.filter((row) => row.itemsInTest > 0 || row.itemsInResearch > 0).length,
  };
}

// ---------------------------------------------------------------------------
// The history dialogs
// ---------------------------------------------------------------------------

/** A duration is never one number. */
export interface ClockPair {
  wall: number | null;
  work: number | null;
}

export interface HistoryPoint {
  date: string;
  isToday: boolean;
  /** The queue band. On a station this is the station TYPE's shared queue. */
  queue: number;
  test: number;
  research: number;
  unmapped: number;
  /** Station: steps processed THAT DAY. Others: closed route runs, cumulative. */
  line: number | null;
  wait: ClockPair;
  handle: ClockPair;
}

export function stationHistoryPoints(rows: StationHistoryWire[]): HistoryPoint[] {
  return rows.map((r) => ({
    date: r.date,
    isToday: r.isToday,
    queue: r._new_sharedTypeQueue,
    test: r.itemsInTest,
    research: r._new_inResearch,
    unmapped: r._new_unmapped,
    // route_run has no station dimension, so what a station "finished" is its
    // steps, counted on the day they happened — never cumulative.
    line: r.totalProcessed,
    wait: { wall: r._new_waitWallMin, work: r._new_waitWorkMin },
    handle: { wall: r._new_handleWallMin, work: r._new_handleWorkMin },
  }));
}

export function entityHistoryPoints(rows: EntityHistoryWire[]): HistoryPoint[] {
  return rows.map((r) => ({
    date: r.date,
    isToday: r.isToday,
    queue: r.itemsInQueue,
    test: r.itemsInTest,
    research: r.itemsInResearch + r.itemsWaitingForResearch,
    unmapped: r._new_unmapped,
    line: "finishedItems" in r ? r.finishedItems : r.itemsFinished,
    // These three dialogs are counts; no clock pair exists and none is invented.
    wait: { wall: null, work: null },
    handle: { wall: null, work: null },
  }));
}

/** One sampled day of a single shipment's completion curve. */
export interface CompletionPoint {
  date: string;
  pct: number;
  /** The denominator: runs of this shipment opened on or before this day. */
  routed: number | null;
  finished: number | null;
}

/** The curve of the ONE shipment a request was pinned to: its series is the
 *  first key that is a shipment code. */
export function completionPoints(rows: CompletionHistoryWire[]): CompletionPoint[] {
  const out: CompletionPoint[] = [];
  for (const row of rows) {
    const code = Object.keys(row).find((k) => k !== "date" && !k.startsWith("_new_"));
    if (!code) continue;
    const pct = Number(row[code]);
    if (Number.isNaN(pct)) continue;
    const counts = row._new_counts?.[code];
    out.push({ date: row.date, pct, routed: counts?.routed ?? null, finished: counts?.finished ?? null });
  }
  return out;
}
