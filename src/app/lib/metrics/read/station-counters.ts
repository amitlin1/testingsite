// Live per-station counts for the Settings > test-stations screen, read through
// the same Q3 query the dashboard's live board uses, so the two screens show
// the same numbers.

import { prisma } from "@/lib/db";
import { stationBoard } from "./queries";

export interface StationLiveCounters {
  stationId: number;
  /** The station TYPE's queue: a `queued` interval carries a station type and
   *  never a station, so the number repeats across the stations of a type and
   *  must never be summed. The research pool belongs to no station and is not in it. */
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
