// Live per-station queue/test counts, read from the trigger-maintained
// station_live_counters table.
//
// Extracted out of the dashboard MetricsService so the Settings screen
// (/api/settings/test-stations) does not depend on the dashboard module —
// the dashboard metrics layer is being replaced, and this small read is the
// only thing operational screens actually need from it.

import { prisma } from "@/app/lib/prisma";

export interface StationLiveCounters {
  stationId: number;
  itemsInQueue: number;
  itemsInTest: number;
}

export async function getStationLiveCounters(): Promise<StationLiveCounters[]> {
  const rows = await prisma.$queryRawUnsafe<
    { station_id: number; items_in_queue: number; items_in_test: number }[]
  >(`
    SELECT station_id, items_in_queue, items_in_test
    FROM station_live_counters
  `);

  return rows.map((row) => ({
    stationId: Number(row.station_id),
    itemsInQueue: Number(row.items_in_queue),
    itemsInTest: Number(row.items_in_test),
  }));
}
