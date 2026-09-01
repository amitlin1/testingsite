// Q5 — §5.6 window-clipped KPIs, on the ledger.
//
// Replaces MetricsService.getKpiStatsFiltered, which aggregates
// item_route_history joined on the item's CURRENT station only: a bias that
// grows with route length, and the reason §9.4 predicts the averages move.
// MetricsService is NOT deleted here — stage 7 does that; it stays so the
// parity harness (§9.3) can keep comparing old against new.
//
// §9.4 intentional differences this route now produces:
//  - averageQueueTimeMinutes / averageProcessingTimeMinutes: every step in the
//    window counts, not only the current station's history rows, and each
//    interval is CLIPPED to the window (§5.6). Accessory work durations are
//    excluded (§5.0(8)) — their `testing` interval is a synthetic ~0-length
//    pair, which used to dilute the processing average at intake stations.
//  - with `workerId` set the old query put a worker_id predicate on a table
//    without that column, raised 42703, and the catch answered HTTP 200 with
//    all-zero KPIs. exited_by_worker_id is a real column on the interval, so
//    this route answers for real.
//  - totalItemsProcessed / treatedCount: "finished" is a route_run closure
//    (§5.3ב), never a sample of terminal intervals.
//  - itemsCurrentlyInQueue / itemsCurrentlyInTest: a true point-in-time probe
//    of the ledger (Q1) rather than item_routes.current_status.
//  - busiestStation*: ranked by work_hours (§5.10). The old workload score
//    (busy + 0.3*wait) is deleted and no longer emitted.

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import {
  finishedInWindow,
  flow,
  kpiWindowOne,
  pointInTime,
} from "@/app/lib/metrics/queries";
import {
  BadRequest,
  metricsJson,
  qualify,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import type { DashboardKpis } from "@/types/dashboard";

export const runtime = "nodejs";

/** metric_state keys behind the two live counters (ms.is_waiting / is_active_work). */
const WAITING = ["queued", "queued_research"];
const ACTIVE = ["testing", "in_research"];

// The two `avgXxxSeconds` fields are widened to `| null` rather than left
// optional: "no rows in the window" is a real answer and must not arrive as a
// missing key that a caller reads as 0 (the exact silent-zero class §5.0 kills).
interface KpisResponse
  extends Omit<DashboardKpis, "avgQueueSeconds" | "avgProcessingSeconds"> {
  avgQueueSeconds: number | null;
  avgProcessingSeconds: number | null;
  // §2.8 — every duration exists as a wall/work PAIR. These are the work twins
  // of the two averages above, plus the gap between them.
  _new_averageQueueWorkMinutes: number | null;
  _new_averageProcessingWorkMinutes: number | null;
  /** §5.10 kpi_offhours_minutes — the window TOTAL of wall minus work, i.e.
   *  "how much of the delay was the calendar". A total, not an average:
   *  tests/average-times reports the per-bucket average as
   *  `_new_avgOffhoursMinutes`. */
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
  /** The station TYPE whose queue busiestStationWaitSeconds reports. */
  _new_busiestStationTypeId: number | null;
  /** §2.8 — the wall twin of busiestStationWaitSeconds. Its busy counterpart
   *  (busiestStationBusySeconds / _new_busiestStationWallHours) and the lab-wide
   *  wait already ship as pairs; the queue must not be the one work-only figure
   *  on the card, or the two clocks get compared against each other by accident.
   *  NULL when the busiest station's TYPE closed no queue interval in the window.
   *  The legacy work-clock field answers 0 in that case only because its wire
   *  type is `number`; this one is the honest half of the pair. */
  _new_busiestStationWaitWallSeconds: number | null;
  /** §2.8 — the lab-wide waiting total, in both clocks, under its own name so
   *  it can never be read as "the busiest station's wait". */
  _new_labWaitWorkSeconds: number;
  _new_labWaitWallSeconds: number;
  /** §5.0(1) — filters route_run cannot express, named rather than dropped. */
  _new_ignoredFilters: string | null;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);

    const [kpi, live, byStation, waitByType, finished] = await Promise.all([
      // Q5: the window is the resolved instant pair, so an interval that is
      // still open at the far edge is clipped at now() rather than skipped.
      kpiWindowOne(prisma, period.fromTs, period.toTsExclusive, filters),
      // Q1 (§5.10 kpi_items_currently_in_queue / _in_test): "currently" is now,
      // not the end of the requested window.
      pointInTime(prisma, new Date(), filters),
      // Q4 by station, whole-window: the busiest station is ranked by
      // work_hours (§5.10), not by a score that mixed busy and wait seconds.
      flow(prisma, period.from, period.to, filters, { dimension: "station", byDay: false }),
      // Q4 by station TYPE, waiting family: the queue is a property of the
      // type, not of one station (§5.4).
      flow(prisma, period.from, period.to, filters, {
        dimension: "station_type",
        family: "waiting",
        byDay: false,
      }),
      // §5.3ב — the one definition of "finished": route_run.closed_at.
      finishedInWindow(prisma, period.from, period.to, filters),
    ]);

    const sumStates = (keys: string[]) =>
      live.filter((r) => keys.includes(r.state_key)).reduce((a, r) => a + r.items, 0);

    // A row with a null station_id is work that carries no station (Q4 keeps it
    // so the totals stay whole); it cannot be "the busiest station".
    //
    // §5.10 ranks by work_hours. The TIE-BREAK is not decoration: on a
    // non-working day every interval closed that day has work_seconds = 0, so
    // work_hours ties at 0 for EVERY station and a bare sort returns whichever
    // row the query happened to emit first. Measured on Friday 2026-08-28 (no
    // work_span rows): the card named תפקודית 1 (13 steps, 0.0002 wall hours)
    // while ויזואלית 1 had done 22 steps and 0.0044 wall hours. Falling through
    // work -> wall -> steps keeps the work clock authoritative and makes the
    // answer deterministic and defensible when it carries no information.
    const busiest =
      [...byStation]
        .filter((r) => r.station_id !== null && r.station_id !== undefined)
        .sort(
          (a, b) =>
            (b.work_hours ?? 0) - (a.work_hours ?? 0) ||
            (b.wall_hours ?? 0) - (a.wall_hours ?? 0) ||
            b.steps_processed - a.steps_processed ||
            (a.station_id ?? 0) - (b.station_id ?? 0)
        )[0] ?? null;

    // §5.10 kpi_busiest_station_wait_seconds is Q4 grouped by station_type with
    // is_waiting — and it is the BUSIEST STATION's wait, which is why the
    // metric is named after it. The queue belongs to the TYPE, not to one
    // station (§5.4), so the number is the type's; the station selects which
    // type. Summing every type instead produced a lab-wide total under a
    // per-station name (measured over 30 days: 5,393,267 s across all types
    // versus 268,273 s the old route reported for the busiest station alone).
    // The lab-wide figure is not lost — it ships beside it, under its own name.
    const busiestType =
      busiest == null
        ? null
        : (waitByType.find((r) => r.station_type_id === busiest.station_type_id) ?? null);
    const waitWorkHours = busiestType?.work_hours ?? 0;
    const waitWallHours = busiestType?.wall_hours ?? null;
    const labWaitWorkHours = waitByType.reduce((a, r) => a + (r.work_hours ?? 0), 0);
    const labWaitWallHours = waitByType.reduce((a, r) => a + (r.wall_hours ?? 0), 0);

    const body: KpisResponse = {
      averageQueueTimeMinutes: kpi.avg_wait_wall_min,
      averageProcessingTimeMinutes: kpi.avg_busy_wall_min,
      avgQueueSeconds: kpi.avg_wait_wall_min === null ? null : kpi.avg_wait_wall_min * 60,
      avgProcessingSeconds: kpi.avg_busy_wall_min === null ? null : kpi.avg_busy_wall_min * 60,
      totalItemsProcessed: finished.finished_runs,
      treatedCount: finished.finished_runs,
      itemsCurrentlyInQueue: sumStates(WAITING),
      itemsCurrentlyInTest: sumStates(ACTIVE),
      busiestStationId: busiest?.station_id ?? null,
      busiestStationName: busiest?.station_name ?? null,
      // §5.10: kpi_busiest_station_count is DELETED as a metric — it was
      // ROUND(busy_sec + 0.3*wait_sec) rendered as "processed N items". The
      // wire field stays (the KPI screen renders it with that exact label) and
      // now carries steps_processed, which is what §5.10 names as its
      // replacement and what the label always claimed to be.
      busiestStationCount: busiest?.steps_processed ?? 0,
      // busiestStationWorkloadScore is DELETED outright (§5.10) and is not
      // emitted; the field is optional in DashboardKpis and nothing renders it.
      busiestStationBusySeconds: Math.round((busiest?.work_hours ?? 0) * 3600),
      busiestStationWaitSeconds: Math.round(waitWorkHours * 3600),

      _new_averageQueueWorkMinutes: kpi.avg_wait_work_min,
      _new_averageProcessingWorkMinutes: kpi.avg_busy_work_min,
      _new_offhoursMinutes: kpi.offhours_min,
      _new_researchWaitWallMinutes: kpi.avg_research_wait_wall_min,
      _new_researchWaitWorkMinutes: kpi.avg_research_wait_work_min,
      _new_researchWallMinutes: kpi.avg_research_wall_min,
      _new_researchWorkMinutes: kpi.avg_research_work_min,
      _new_waitRecordCount: kpi.wait_n,
      _new_busyRecordCount: kpi.busy_n,
      _new_unitsTouched: kpi.units_touched,
      _new_busiestStationWorkHours: busiest?.work_hours ?? null,
      _new_busiestStationWallHours: busiest?.wall_hours ?? null,
      _new_busiestStationStepsProcessed: busiest?.steps_processed ?? null,
      _new_busiestStationTypeId: busiest?.station_type_id ?? null,
      _new_busiestStationWaitWallSeconds:
        waitWallHours === null ? null : Math.round(waitWallHours * 3600),
      _new_labWaitWorkSeconds: Math.round(labWaitWorkHours * 3600),
      _new_labWaitWallSeconds: Math.round(labWaitWallHours * 3600),
      // Only totalItemsProcessed / treatedCount are affected: route_run has no
      // station / station type / worker / state dimension, while every other
      // number here carries the full §5.1 block.
      _new_ignoredFilters:
        qualify("totalItemsProcessed", finished.ignoredFilters).join(",") || null,
    };

    return metricsJson(body, period, filters);
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // The old route answered HTTP 200 with all-zero KPIs here. That is the
    // failure mode §9.4 documents (a 42703 shown to a manager as "0 minutes"),
    // so a real failure is now a real status code.
    console.error("Error fetching dashboard KPIs:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard KPIs" }, { status: 500 });
  }
}, { role: "manager" });
