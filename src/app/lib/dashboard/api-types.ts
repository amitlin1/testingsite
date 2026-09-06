// ONE ADAPTER PER ENDPOINT (§16.4).
//
// The ledger rewrite ships its additions under a `_new_` prefix — a marker for
// "a field the old response never had". The prefix is temporary; when upstream
// drops it, every component keeps compiling because nothing outside this file
// reads a `_new_` name. Rows arrive here raw and leave as the plain shapes the
// tabs render, with the two-clock pairs, the nullable ratios and the
// ignored-filter lists already named for what they are.
//
// Nothing in this file coerces a null to a zero. §16.3: `null` is the answer
// "no denominator", and it renders as an em dash.

import type {
  AverageTimesPoint,
  CustomerPerformanceRow,
  DashboardKpis,
  ItemTypeTrackingRow,
  ShipmentTrackingRow,
  SlowItemRow,
  StationLoadRow,
  StatusDistribution,
} from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Wire shapes — exactly what each route serialises today.
// ---------------------------------------------------------------------------

export interface KpisWire extends Omit<DashboardKpis, "avgQueueSeconds" | "avgProcessingSeconds"> {
  avgQueueSeconds: number | null;
  avgProcessingSeconds: number | null;
  _new_averageQueueWorkMinutes: number | null;
  _new_averageProcessingWorkMinutes: number | null;
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
  _new_busiestStationWaitWallSeconds: number | null;
  _new_labWaitWorkSeconds: number;
  _new_labWaitWallSeconds: number;
  _new_ignoredFilters: string | null;
}

export interface StationWire extends StationLoadRow {
  _new_itemsInResearch: number;
  _new_researchPoolQueue: number;
  _new_standingQueueAgeWorkMinutes: number | null;
  _new_oldestQueueAgeWallMinutes: number | null;
  _new_oldestQueueAgeWorkMinutes: number | null;
  _new_p95QueueAgeWallMinutes: number | null;
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
  _new_durationRecordCount: number;
  _new_avgBusyWallMinutes: number | null;
  _new_avgBusyWorkMinutes: number | null;
  _new_busyWallHours: number | null;
  _new_busyWorkHours: number | null;
  _new_p95WallMinutes: number | null;
  _new_p95WorkMinutes: number | null;
  _new_maxWallMinutes: number | null;
  _new_maxWorkMinutes: number | null;
  _new_typeWaitWallHours: number | null;
  _new_typeWaitWorkHours: number | null;
  _new_typeWaitAvgWallMinutes: number | null;
  _new_typeWaitAvgWorkMinutes: number | null;
}

export interface SlowItemWire extends Omit<SlowItemRow, "serialNo" | "makat"> {
  serialNo: string | null;
  makat: string | null;
  _new_attemptNo: number;
  _new_entryReason: string;
  _new_workerName: string | null;
  _new_customerId: number | null;
  _new_customerName: string | null;
  _new_queueWorkMinutes: number | null;
  _new_processingWorkMinutes: number | null;
  _new_totalWorkMinutes: number | null;
}

export interface ShipmentWire
  extends Omit<ShipmentTrackingRow, "completionPercentage" | "itemsInRoutesPercentage"> {
  completionPercentage: number | null;
  itemsInRoutesPercentage: number | null;
  _new_routedUnits: number;
  _new_finishedRuns: number;
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
  _new_shipTurnaroundWallMinutes: number | null;
  _new_shipTurnaroundWorkMinutes: number | null;
  _new_ignoredFilters: string | null;
}

export interface CustomerWire
  extends Omit<CustomerPerformanceRow, "successPercentage" | "itemsInRoutesPercentage"> {
  successPercentage: number | null;
  itemsInRoutesPercentage: number | null;
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  _new_averageTimeWorkMinutes: number | null;
  _new_windowStepsProcessed: number;
  _new_windowAvgProcessingWallMinutes: number | null;
  _new_windowAvgProcessingWorkMinutes: number | null;
  _new_windowAvgWaitWallMinutes: number | null;
  _new_windowAvgWaitWorkMinutes: number | null;
}

export interface ItemTypeWire
  extends Omit<ItemTypeTrackingRow, "completionPercentage" | "itemsInRoutesPercentage"> {
  completionPercentage: number | null;
  itemsInRoutesPercentage: number | null;
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
}

export interface AverageTimesWire extends AverageTimesPoint {
  _new_avgWaitingWorkMinutes: number | null;
  _new_avgProcessingWorkMinutes: number | null;
  _new_avgOffhoursMinutes: number | null;
  _new_p95WaitingWallMinutes: number | null;
  _new_p95WaitingWorkMinutes: number | null;
  _new_p95ProcessingWallMinutes: number | null;
  _new_p95ProcessingWorkMinutes: number | null;
  _new_waitRecordCount: number;
  _new_stepsProcessed: number;
}

export interface StatusWire extends StatusDistribution {
  _new_stateKey: string;
  _new_units: number;
  _new_asOf: string;
}

export interface StatusHistoryWire {
  date: string;
  isToday: boolean;
  statuses: Array<{
    status: string;
    statusName: string;
    count: number;
    percentage: number | null;
    _new_stateKey: string;
    _new_series: "point_in_time" | "cumulative";
  }>;
  finishedCumulative: number;
  /** Every run, accessories included. */
  _new_finishedToday: number;
  /** The throughput PAIR — one population, accessories excluded from both. */
  _new_workStartedToday: number;
  _new_workFinishedToday: number;
  _new_activeTotal: number;
}

/** stations/[id]/history — the only dialog whose series carries a clock pair. */
export interface StationHistoryWire {
  date: string;
  isToday: boolean;
  itemsInTest: number;
  _new_inResearch: number;
  _new_sharedTypeQueue: number;
  _new_unmapped: number;
  totalProcessed: number;
  _new_waitSamples: number;
  _new_handleSamples: number;
  _new_waitWallMin: number | null;
  _new_waitWorkMin: number | null;
  _new_handleWallMin: number | null;
  _new_handleWorkMin: number | null;
}

/** {customers,shipments,item-types}/[id]/history — counts only, no clock pair. */
export interface EntityHistoryWire {
  date: string;
  isToday: boolean;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  _new_unmapped: number;
  _new_activeTotal: number;
  _new_finishedToday: number;
  /** `finishedItems` on the customer route, `itemsFinished` on the other two. */
  finishedItems?: number;
  itemsFinished?: number;
}

/**
 * stats/completion-history — every key that is not `date`/`formattedDate` and
 * does not start with `_new_` is a SHIPMENT CODE whose value is the ratio as a
 * one-decimal string. `_new_counts` carries the two numbers behind that ratio,
 * per code, so a fall in the line can be read as what it is.
 */
export interface CompletionHistoryWire {
  date: string;
  _new_counts?: Record<string, { routed: number; finished: number }>;
  [shipmentCode: string]: string | Record<string, { routed: number; finished: number }> | undefined;
}

/** One sampled day of a single shipment's completion curve. */
export interface CompletionPoint {
  date: string;
  pct: number | null;
  /** The denominator: runs of this shipment opened on or before this day. */
  routed: number | null;
  finished: number | null;
}

// ---------------------------------------------------------------------------
// Normalised shapes — what the components render.
// ---------------------------------------------------------------------------

/** §16.1 — a duration is never one number. */
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
    // Never cumulative: route_run has no station dimension, so what a station
    // "finished" is steps, counted on the day they happened (§16.5).
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
    line: r.finishedItems ?? r.itemsFinished ?? 0,
    // §16.5: these three dialogs are counts, not durations. There is no clock
    // pair to show and none is invented — the duration chart is station-only.
    wait: { wall: null, work: null },
    handle: { wall: null, work: null },
  }));
}
