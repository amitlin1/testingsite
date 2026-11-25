// One station's history: Q2א and Q4, over one daily grid at 12:00 Asia/Jerusalem.
//
//   Q2א by station_id       itemsInTest and _new_inResearch — the two states a
//                           station actually holds, reported apart.
//   Q2א by station_type_id  _new_sharedTypeQueue: the items waiting for this
//                           station's TYPE. A waiting item is at no station (a
//                           `queued` interval carries no station_id, §3.6), so
//                           the queue is shared with every station of the type,
//                           and the name says so.
//   Q4 by station_id        totalProcessed (every recorded outcome, returns from
//                           research included) and the HANDLING clock pair.
//   Q4 by station_type_id   the WAIT clock pair over the type's closed waits.
//
// Two clocks, four columns, four names (§2.8). A day on which nothing closed
// carries NULL in all four — not 0, not last week's value (§5.0(7)).
// Accessory durations are out of the handling pair and in the waiting pair
// (§5.0(8)); the counts include them.
//
// Q2ב is deliberately not used: route_run has no station dimension — a run is
// finished as a whole, not at a station. What a station finishes is its steps.
// Historical.

import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { requireDbId } from "@/lib/http/request";
import type { StationHistoryWire } from "@/app/lib/dashboard/contract";
import { dayRows } from "@/app/lib/metrics/read/day-rows";
import { flow, pitSeries } from "@/app/lib/metrics/read/queries";
import type { StateKey } from "@/app/lib/metrics/vocabulary";
import { metricsRoute } from "../../../_lib/metrics-route";

/** The states a station holds, and where each is reported. The waiting states
 *  carry no station_id (§3.6), so the station-filtered series has them at zero;
 *  the real queue is the type's, read separately. */
const HELD: Partial<Record<StateKey, "itemsInTest" | "_new_inResearch" | "_new_unmapped">> = {
  testing: "itemsInTest",
  in_research: "_new_inResearch",
  unmapped: "_new_unmapped",
};

export const GET = metricsRoute<"dialog", { id: string }>("dialog", "Internal Server Error", async ({ period, params, filters: { scope } }) => {
  const stationId = requireDbId(params.id, "Station ID is required");

  const station = await prisma.test_stations.findUnique({
    where: { test_station_id: stationId },
    select: { test_station_type_id: true },
  });
  if (!station) throw new HttpError(404, "Station not found");

  const atStation = { stationId, scope };
  const ofType = { stationTypeId: station.test_station_type_id, scope };

  const [held, typeQueue, waiting, working] = await Promise.all([
    pitSeries(prisma, period.from, period.to, atStation),
    pitSeries(prisma, period.from, period.to, { ...ofType, states: ["queued"] }),
    flow(prisma, period.from, period.to, ofType, { dimension: "station_type", family: "waiting", byDay: true }),
    flow(prisma, period.from, period.to, atStation, { dimension: "station", family: "active_work", byDay: true }),
  ]);

  const days = dayRows(
    (date): StationHistoryWire => ({
      date,
      isToday: date === period.today,
      itemsInTest: 0,
      _new_inResearch: 0,
      _new_sharedTypeQueue: 0,
      _new_unmapped: 0,
      totalProcessed: 0,
      _new_waitSamples: 0,
      _new_handleSamples: 0,
      _new_waitWallMin: null,
      _new_waitWorkMin: null,
      _new_handleWallMin: null,
      _new_handleWorkMin: null,
    }),
  );

  for (const r of held) {
    const day = days.at(r.business_day);
    const field = HELD[r.state_key as StateKey];
    if (field) day[field] = r.items;
  }
  for (const r of typeQueue) days.at(r.business_day)._new_sharedTypeQueue = r.items;
  // Q4: one row per (close day, dimension); the filter pins the dimension.
  for (const r of waiting) {
    if (!r.d) continue;
    const day = days.at(r.d);
    day._new_waitSamples = r.n;
    day._new_waitWallMin = r.avg_wall_min;
    day._new_waitWorkMin = r.avg_work_min;
  }
  for (const r of working) {
    if (!r.d) continue;
    const day = days.at(r.d);
    day.totalProcessed = r.steps_processed;
    day._new_handleSamples = r.n;
    day._new_handleWallMin = r.avg_wall_min;
    day._new_handleWorkMin = r.avg_work_min;
  }

  // Q2א and Q4 both express every filter this endpoint applies: nothing ignored.
  return { body: days.sorted(), filters: atStation };
}, { historical: true });
