// The KPI cards: Q5 (§5.6) over the window, every interval clipped to it and
// accessory work durations excluded (§5.0(8)); "currently" from Q1 at now();
// the busiest station from Q4 ranked by work hours (§5.10); "finished" is a
// route_run closure (§5.3ב).

import { prisma } from "@/lib/db";
import type { KpisWire } from "@/app/lib/dashboard/contract";
import { ACTIVE_STATES, WAITING_STATES, type StateKey } from "@/app/lib/metrics/vocabulary";
import { qualify } from "@/app/lib/metrics/read/filters";
import { finishedInWindow, flow, kpiWindow, pointInTime } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch dashboard KPIs", async ({ period, filters }) => {
  const [kpi, live, byStation, waitByType, finished] = await Promise.all([
    kpiWindow(prisma, period.fromTs, period.toTsExclusive, filters),
    pointInTime(prisma, new Date(), filters),
    flow(prisma, period.from, period.to, filters, { dimension: "station", byDay: false }),
    // The queue belongs to the station TYPE, not to one station (§5.4).
    flow(prisma, period.from, period.to, filters, { dimension: "station_type", family: "waiting", byDay: false }),
    finishedInWindow(prisma, period.from, period.to, filters),
  ]);

  const sumStates = (keys: readonly StateKey[]) =>
    live.filter((r) => keys.includes(r.state_key as StateKey)).reduce((a, r) => a + r.items, 0);

  // Work with no station is kept in Q4 so totals stay whole; it cannot be "the
  // busiest station". THE TIE-BREAK IS NOT DECORATION: on a non-working day
  // every interval closed that day has work_seconds = 0, so work_hours ties at
  // 0 for EVERY station and a bare sort returns whichever row came first.
  // Measured on Friday 2026-08-28 (no work_span rows): the card named a station
  // with 13 steps while another had done 22. Falling through work -> wall ->
  // steps keeps the work clock authoritative and the answer deterministic.
  const busiest =
    [...byStation]
      .filter((r) => r.station_id !== null && r.station_id !== undefined)
      .sort(
        (a, b) =>
          (b.work_hours ?? 0) - (a.work_hours ?? 0) ||
          (b.wall_hours ?? 0) - (a.wall_hours ?? 0) ||
          b.steps_processed - a.steps_processed ||
          (a.station_id ?? 0) - (b.station_id ?? 0),
      )[0] ?? null;

  // §5.10 kpi_busiest_station_wait_seconds is the BUSIEST STATION's wait, and
  // the queue is its TYPE's; the station only selects which type. The lab-wide
  // total ships beside it under its own name.
  const busiestType =
    busiest == null ? null : (waitByType.find((r) => r.station_type_id === busiest.station_type_id) ?? null);
  const waitWorkHours = busiestType?.work_hours ?? 0;
  const waitWallHours = busiestType?.wall_hours ?? null;
  const labWaitWorkHours = waitByType.reduce((a, r) => a + (r.work_hours ?? 0), 0);
  const labWaitWallHours = waitByType.reduce((a, r) => a + (r.wall_hours ?? 0), 0);

  // Only the closed-runs count is affected: route_run has no station / station
  // type / worker / state, while every other number carries the full block.
  const ignored = qualify("totalItemsProcessed", finished.ignoredFilters);

  const body = {
    averageQueueTimeMinutes: kpi.avg_wait_wall_min,
    averageProcessingTimeMinutes: kpi.avg_busy_wall_min,
    avgQueueSeconds: kpi.avg_wait_wall_min === null ? null : kpi.avg_wait_wall_min * 60,
    avgProcessingSeconds: kpi.avg_busy_wall_min === null ? null : kpi.avg_busy_wall_min * 60,
    totalItemsProcessed: finished.finished_runs,
    treatedCount: finished.finished_runs,
    itemsCurrentlyInQueue: sumStates(WAITING_STATES),
    itemsCurrentlyInTest: sumStates(ACTIVE_STATES),
    busiestStationId: busiest?.station_id ?? null,
    busiestStationName: busiest?.station_name ?? null,
    busiestStationCount: busiest?.steps_processed ?? 0,
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
    _new_busiestStationWaitWallSeconds: waitWallHours === null ? null : Math.round(waitWallHours * 3600),
    _new_labWaitWorkSeconds: Math.round(labWaitWorkHours * 3600),
    _new_labWaitWallSeconds: Math.round(labWaitWallHours * 3600),
    _new_ignoredFilters: ignored.join(",") || null,
  } satisfies KpisWire;

  return { body, filters, ignored };
});
