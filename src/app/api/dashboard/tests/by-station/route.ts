// The station board: Q3 (§5.4, the live board) + Q4 (§5.5, the window).
//
// THE TWO HALVES ARE FILTERED DIFFERENTLY. Q3 is the state of the LAB and
// carries no §5.1 filter block, but its rows carry station and station type,
// so those two narrow the ROW SET (the counts inside a row stay lab-wide); the
// other filters are named in X-Metrics-Ignored-Filters. Q4 carries the whole
// block.
//
// The queue belongs to the station TYPE: a `queued` interval carries a
// station_type_id and never a station_id, so `itemsInQueue` and the typeWait
// columns repeat across the stations of a type and must never be summed. The
// research pool (`queued_research`) belongs to no station at all and ships as
// its own number.

import { prisma } from "@/lib/db";
import type { StationWire } from "@/app/lib/dashboard/contract";
import { LEGACY_STATUS_STATES, isLegacyStatusFilter, type StateKey } from "@/app/lib/metrics/vocabulary";
import { qualify, unhonoured } from "@/app/lib/metrics/read/filters";
import { flow, stationBoard } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

/** The legacy `status` selector projected onto the board's live columns: a
 *  column shows when the selected set holds its state (no selector = all). */
function shownColumns(status: string | null): { queue: boolean; test: boolean } {
  if (!status) return { queue: true, test: true };
  const states: readonly StateKey[] | null | undefined = isLegacyStatusFilter(status)
    ? LEGACY_STATUS_STATES[status]
    : undefined;
  if (states === null) return { queue: true, test: true };
  return { queue: states?.includes("queued") ?? false, test: states?.includes("testing") ?? false };
}

export const GET = metricsRoute("window", "Failed to fetch station load data", async ({ period, filters, searchParams }) => {
  const [board, work, wait] = await Promise.all([
    stationBoard(prisma),
    flow(prisma, period.from, period.to, filters, { dimension: "station", byDay: false }),
    flow(prisma, period.from, period.to, filters, { dimension: "station_type", family: "waiting", byDay: false }),
  ]);

  const workById = new Map(work.map((r) => [r.station_id, r]));
  const waitByType = new Map(wait.map((r) => [r.station_type_id, r]));
  const show = shownColumns(searchParams.get("status"));

  const stations = board
    .filter(
      (b) =>
        (filters.stationId == null || b.test_station_id === filters.stationId) &&
        (filters.stationTypeId == null || b.station_type_id === filters.stationTypeId),
    )
    .map((b) => {
      const w = workById.get(b.test_station_id);
      const q = waitByType.get(b.station_type_id);
      return {
        stationId: b.test_station_id,
        stationName: b.station_name ?? "",
        stationTypeName: b.station_type_name,
        itemsInQueue: show.queue ? b.shared_type_queue : 0,
        itemsInTest: show.test ? b.in_test : 0,
        averageCurrentQueueTimeMinutes: b.standing_queue_age_wall_min,
        totalProcessedInPeriod: w ? w.steps_processed : 0,

        _new_itemsInResearch: show.test ? b.in_research : 0,
        _new_researchPoolQueue: b.research_pool_queue,
        _new_standingQueueAgeWorkMinutes: b.standing_queue_age_work_min,
        _new_oldestQueueAgeWallMinutes: b.oldest_queue_age_wall_min,
        _new_oldestQueueAgeWorkMinutes: b.oldest_queue_age_work_min,
        _new_p95QueueAgeWallMinutes: b.p95_queue_age_wall_min,
        _new_p95QueueAgeWorkMinutes: b.p95_queue_age_work_min,
        _new_activeTestAgeWallMinutes: b.active_test_age_wall_min,
        _new_activeTestAgeWorkMinutes: b.active_test_age_work_min,

        _new_operations: w ? w.operations : 0,
        _new_stepsCompleted: w ? w.steps_completed : 0,
        _new_divertedToResearch: w ? w.diverted_to_research : 0,
        _new_returnedFromResearch: w ? w.returned_from_research : 0,
        _new_abandonments: w ? w.abandonments : 0,
        _new_reworkSteps: w ? w.rework_steps : 0,
        _new_restartsAfterAbandonment: w ? w.restarts_after_abandonment : 0,
        _new_manualEntries: w ? w.manual_entries : 0,
        _new_durationRecordCount: w ? w.n : 0,
        _new_avgBusyWallMinutes: w ? w.avg_wall_min : null,
        _new_avgBusyWorkMinutes: w ? w.avg_work_min : null,
        _new_busyWallHours: w ? w.wall_hours : null,
        _new_busyWorkHours: w ? w.work_hours : null,
        _new_p95WallMinutes: w ? w.p95_wall_min : null,
        _new_p95WorkMinutes: w ? w.p95_work_min : null,
        _new_maxWallMinutes: w ? w.max_wall_min : null,
        _new_maxWorkMinutes: w ? w.max_work_min : null,
        // §5.0(3): typeWait_* (closed waits — flow) never shares a name with the
        // standing queue age (who is waiting now — state).
        _new_typeWaitWallHours: q ? q.wall_hours : null,
        _new_typeWaitWorkHours: q ? q.work_hours : null,
        _new_typeWaitAvgWallMinutes: q ? q.avg_wall_min : null,
        _new_typeWaitAvgWorkMinutes: q ? q.avg_work_min : null,
      } satisfies StationWire;
    });

  return { body: stations, filters, ignored: qualify("liveBoard", unhonoured("liveBoard", filters)) };
});
