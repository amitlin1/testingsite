// Live per-station queue/test counts for the Settings > test-stations screen,
// read from the metrics ledger (Q3, §5.4) via stationBoard().
//
// It used to read station_live_counters, a trigger-maintained table that stage 7
// DROPs together with its trigger — after which this screen would have shown a
// silent column of zeros. §8 stage 5 names the conversion as its own deliverable
// for exactly that reason.
//
// The dependency direction is deliberate: the old extraction avoided the
// dashboard's MetricsService, and this still does. queries.ts is the ledger's
// query layer, not a dashboard screen — it is the same code path the dashboard
// reads, which is what "the Settings page shows the SAME numbers as the
// Dashboard" was always meant to guarantee.
//
// TWO NUMBERS CHANGE MEANING, AND BOTH ARE RENAMED SO THE CHANGE IS VISIBLE:
//
//  - `sharedTypeQueue` (was `itemsInQueue`). The old trigger attributed each
//    waiting item to one station. The ledger cannot and must not: a `queued`
//    interval carries NO station_id, only a station_type_id (0 of 3,151 rows on
//    the dev database). So the number is the station TYPE's queue — it REPEATS
//    across the stations of a type and must never be summed down the list.
//    Items waiting for the research pool (`queued_research`) belong to no
//    station at all and are therefore not in it; a research station's queue
//    column now reads 0 rather than a share of the pool.
//  - `itemsInActiveWork` (was `itemsInTest`) is `testing` + `in_research`, the
//    ledger's is_active_work pair. The old counter's set — current_status IN
//    (1,5) — was the same two states, so the number is preserved; the name now
//    says why a research station is counted in it.

import { prisma } from "@/app/lib/prisma";
import { stationBoard } from "@/app/lib/metrics/queries";

export interface StationLiveCounters {
  stationId: number;
  /** The station TYPE's queue. Repeats across the type; never sum it. */
  sharedTypeQueue: number;
  /** Items being worked on AT this station: testing + in_research. */
  itemsInActiveWork: number;
}

export async function getStationLiveCounters(): Promise<StationLiveCounters[]> {
  const board = await stationBoard(prisma);

  return board.map((row) => ({
    stationId: row.test_station_id,
    sharedTypeQueue: row.shared_type_queue,
    itemsInActiveWork: row.in_test + row.in_research,
  }));
}
