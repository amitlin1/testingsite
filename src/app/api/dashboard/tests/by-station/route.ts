// Q3 (§5.4, the live station board) + Q4 (§5.5, flow and duration), on the
// ledger. Replaces MetricsService.getStationStats, which is left in place for
// the parity harness until stage 7.
//
// THE TWO HALVES ANSWER DIFFERENT QUESTIONS AND ARE FILTERED DIFFERENTLY.
//
//   itemsInQueue / itemsInTest / averageCurrentQueueTimeMinutes come from Q3,
//   a probe of what is happening RIGHT NOW. §5.4's SQL carries no §5.1 filter
//   block — §5.1 lists Q1, Q2, Q4, Q5, Q6, Q7, Q8 and pointedly not Q3, because
//   the live board is the state of the lab, not of one customer's slice. Two of
//   the dimensions are still answerable, because the board row itself carries
//   them (station and station type), and those are applied to the ROW SET here.
//   Everything else a caller asked for is named in the X-Metrics-Ignored-Filters
//   response header rather than dropped in silence (§5.0(1)).
//
//   totalProcessedInPeriod and every _new_ flow/duration field come from Q4
//   over the requested window, and Q4 DOES carry the whole filter block.
//
// §9.4 intentional differences:
//  - itemsInQueue is `shared_type_queue`: the queue belongs to the station
//    TYPE, not to a station (§5.4). MEASURED, because the direction matters and
//    an earlier draft of this comment had it backwards: over 30 days the old
//    route reported 5 and 3 for ויזואלית 1 / ויזואלית 2 (it attributed each
//    waiting item to one station via item_routes.test_station_id) and the new
//    board reports the type's 8 on BOTH rows. The ledger cannot do it the old
//    way and must not pretend to: a `queued` interval carries NO station_id at
//    all (0 of 3,151 rows on this database — metric_state.at_station is false
//    for `queued`), only a station_type_id. So the column is the TYPE's queue,
//    it repeats across the stations of a type, and it must not be summed down
//    the table. Stage 6 renames the column accordingly; until then the honest
//    number is the one that exists.
//    The same fact governs the window's WAITING durations: they are grouped by
//    station type too, and ship as `_new_typeWait*` so the repetition is legible
//    in the field name and nobody totals a column of duplicates.
//  - a research station's itemsInQueue / itemsInTest read 0 where the old
//    numbers were 2 and 2 (station 12, measured). The old query used the WIDE
//    sets — current_status IN (2,4) and IN (1,5) — so research counted as
//    queue/test; Q3 splits them because `queued_research` belongs to a shared
//    POOL with no station at all (§5.4: "one count; no double-count between
//    research stations"). Both halves ship: `_new_researchPoolQueue` and
//    `_new_itemsInResearch`. Until stage 6 adopts them the two legacy columns
//    under-report the research lab, which is why they are named here.
//  - the queue's AGE now ships as a distribution, not as one number: the mean
//    (`averageCurrentQueueTimeMinutes`, unchanged) plus `_new_oldestQueueAge*`
//    and `_new_p95QueueAgeWallMinutes`. The mean answers "is this queue busy";
//    the max answers "is something rotting in it", which is what the board is
//    actually opened for, and a mean over twenty items that arrived in the last
//    ten minutes hides a single item that has been waiting since Thursday.
//  - averageCurrentQueueTimeMinutes is `standing_queue_age_wall_min`, measured
//    over the items WAITING for this station type. The old number averaged the
//    running tests instead, so a station with 22 items waiting 47 minutes and
//    two 6-9 minute tests reported 7.5. The age of the running tests is not
//    lost — it is `_new_activeTestAge{Wall,Work}Minutes`, a new metric in both
//    clocks (§5.0(10)).
//  - totalProcessedInPeriod: "processed" includes returned_to_route and
//    sent_to_research (§5.0(2)), so research stations stop reporting 3 of 30;
//    and the synthetic station-0 rows written by PUT /api/items/[id]/status
//    have no ledger interval, so they no longer inflate it.

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { flow, stationBoard } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  liveBoardIgnoredFilters,
  metricsJson,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import type { StationLoadRow } from "@/types/dashboard";

export const runtime = "nodejs";

interface StationLoadResponseRow extends StationLoadRow {
  // Q3 additions (§5.10) — the live board, in both clocks.
  _new_itemsInResearch: number;
  _new_researchPoolQueue: number;
  _new_standingQueueAgeWorkMinutes: number | null;
  /** The OLDEST item still waiting for this station's TYPE, in both clocks, plus
   *  the p95 shoulder. `averageCurrentQueueTimeMinutes` stays the mean and keeps
   *  the wire contract; the board reads the max, because a mean of ages is
   *  diluted by whoever just joined the queue and hides the one item that has
   *  been rotting there since Thursday. p95 says which of the two it is. */
  _new_oldestQueueAgeWallMinutes: number | null;
  _new_oldestQueueAgeWorkMinutes: number | null;
  _new_p95QueueAgeWallMinutes: number | null;
  _new_activeTestAgeWallMinutes: number | null;
  _new_activeTestAgeWorkMinutes: number | null;
  // Q4 additions — the window's flow, and its durations in both clocks.
  // No _new_unitsProcessed here: §5.0(6) makes unit_id an illegal de-duplication
  // key under the station dimension (an accessory shares its parent's unit_id
  // but its steps land at other stations), so buildFlow does not emit the column
  // at all. Declaring it anyway shipped `undefined`, which JSON.stringify drops —
  // a field the contract promised and the payload never carried.
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
  // The queue is the station TYPE's (a `queued` interval carries no station_id
  // at all), so these four are TYPE-level and REPEAT across the stations of a
  // type. The name says so, because a column that repeats must never be summed
  // down the table — same rule as `shared_type_queue`.
  _new_typeWaitWallHours: number | null;
  _new_typeWaitWorkHours: number | null;
  _new_typeWaitAvgWallMinutes: number | null;
  _new_typeWaitAvgWorkMinutes: number | null;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);
    const status = searchParams.get("status");

    const [board, work, wait] = await Promise.all([
      stationBoard(prisma),
      flow(prisma, period.from, period.to, filters, { dimension: "station", byDay: false }),
      // Grouped by station TYPE, not by station: `queued` intervals carry a
      // station_type_id and never a station_id (0 of 3,151 rows here), so the
      // station grouping put every waiting row in the NULL bucket and the four
      // wait columns were structurally always null. tests/kpis groups the same
      // family the same way.
      flow(prisma, period.from, period.to, filters, {
        dimension: "station_type",
        family: "waiting",
        byDay: false,
      }),
    ]);

    const workById = new Map(work.map((r) => [r.station_id, r]));
    const waitByType = new Map(wait.map((r) => [r.station_type_id, r]));

    // The station and station-type filters ARE honoured against the live board:
    // both are columns of the board row, so narrowing the row set here is exact
    // rather than an approximation. (The counts inside a row stay lab-wide —
    // see the header comment.)
    const visible = board.filter(
      (b) =>
        (filters.stationId == null || b.test_station_id === filters.stationId) &&
        (filters.stationTypeId == null || b.station_type_id === filters.stationTypeId)
    );

    // The legacy `status` selector projects onto the two live columns exactly as
    // it always has. This is a display projection of a filter the ledger applies
    // for real everywhere else; keeping it preserves the query-param contract.
    const showQueue = !status || status === "all" || status === "queue";
    const showTest = !status || status === "all" || status === "processing";

    const stations: StationLoadResponseRow[] = visible.map((b) => {
      const w = workById.get(b.test_station_id);
      const q = waitByType.get(b.station_type_id);
      return {
        stationId: b.test_station_id,
        stationName: b.station_name ?? "",
        stationTypeName: b.station_type_name,
        itemsInQueue: showQueue ? b.shared_type_queue : 0,
        itemsInTest: showTest ? b.in_test : 0,
        averageCurrentQueueTimeMinutes: b.standing_queue_age_wall_min,
        totalProcessedInPeriod: w ? w.steps_processed : 0,

        _new_itemsInResearch: showTest ? b.in_research : 0,
        _new_researchPoolQueue: b.research_pool_queue,
        _new_standingQueueAgeWorkMinutes: b.standing_queue_age_work_min,
        _new_oldestQueueAgeWallMinutes: b.oldest_queue_age_wall_min,
        _new_oldestQueueAgeWorkMinutes: b.oldest_queue_age_work_min,
        _new_p95QueueAgeWallMinutes: b.p95_queue_age_wall_min,
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
        // §5.0(8): the duration denominator excludes accessories, so it is not
        // the same number as steps_processed and carries its own name.
        _new_durationRecordCount: w ? w.n : 0,
        _new_avgBusyWallMinutes: w ? w.avg_wall_min : null,
        _new_avgBusyWorkMinutes: w ? w.avg_work_min : null,
        _new_busyWallHours: w ? w.wall_hours : null,
        _new_busyWorkHours: w ? w.work_hours : null,
        _new_p95WallMinutes: w ? w.p95_wall_min : null,
        _new_p95WorkMinutes: w ? w.p95_work_min : null,
        _new_maxWallMinutes: w ? w.max_wall_min : null,
        _new_maxWorkMinutes: w ? w.max_work_min : null,
        // §5.0(3): `typeWait_*` (closed queue intervals — flow) never shares a
        // name with `standing_queue_age_*` (the age of who is waiting now —
        // state).
        _new_typeWaitWallHours: q ? q.wall_hours : null,
        _new_typeWaitWorkHours: q ? q.work_hours : null,
        _new_typeWaitAvgWallMinutes: q ? q.avg_wall_min : null,
        _new_typeWaitAvgWorkMinutes: q ? q.avg_work_min : null,
      };
    });

    return metricsJson(stations, period, filters, liveBoardIgnoredFilters(filters));
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // The old route answered HTTP 200 with `[]` here, which a manager reads as
    // "no work today" rather than "the query failed".
    console.error("Error fetching station load data:", error);
    return NextResponse.json({ error: "Failed to fetch station load data" }, { status: 500 });
  }
}, { role: "manager" });
