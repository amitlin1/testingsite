import { Prisma } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { AT_STEP_STATUSES, ItemStatus, RESEARCH_STATUSES, StationStatus, WAITING_STATUSES } from "@/lib/item-status";

/**
 * Which station an item is assigned to — three policies, side by side. Each write path calls the
 * ones it always called, in the same order; whether a result should run both of its pairs (it
 * writes two `station_reassigned` notes and the second wins) is the owner's question.
 *
 *   findBestStation              a free station of the pool, else the active one with the fewest
 *                                waiting — every write that places an item at a route step (the
 *                                step's type), and a result sent to research (the research stations)
 *   findLeastWaitingStation      fewest waiting, then fewest active, a random one among equals —
 *                                a result's next station (the one the worker is shown)
 *   findLeastLoadedResearchStation  fewest waiting for or in research, a random one among equals —
 *                                a result sent to research (the one the worker is shown)
 */

/** The stations a pick is among: those of a station type, or the research stations. */
export type StationPool = { stationTypeId: number } | "research";

/** A free station (status 2) of the pool, else the active one (status 1) with the fewest items
 *  waiting; never a disabled one. Null when there is neither. */
export async function findBestStation(tx: TransactionClient, pool: StationPool): Promise<number | null> {
  const among = pool === "research" ? { is_research: true } : { test_station_type_id: pool.stationTypeId };
  const free = await tx.test_stations.findFirst({
    where: { ...among, status: StationStatus.Free },
    select: { test_station_id: true },
  });
  if (free) return free.test_station_id;

  const amongSql = pool === "research"
    ? Prisma.sql`ts.is_research = true`
    : Prisma.sql`ts.test_station_type_id = ${pool.stationTypeId}`;
  const [leastLoaded] = await tx.$queryRaw<{ test_station_id: number }[]>`
    SELECT ts.test_station_id
    FROM test_stations ts
    LEFT JOIN (
      SELECT test_station_id, COUNT(*) AS queue_count
      FROM item_routes
      WHERE current_status IN (${Prisma.join(WAITING_STATUSES)}) AND finished_at IS NULL
      GROUP BY test_station_id
    ) ir ON ir.test_station_id = ts.test_station_id
    WHERE ${amongSql} AND ts.status = ${StationStatus.Active}
    ORDER BY COALESCE(ir.queue_count, 0) ASC
    LIMIT 1
  `;
  return leastLoaded?.test_station_id ?? null;
}

/** findBestStation for the station type of a route's step (1-based). Null when the route or the
 *  step does not exist (the item finished its route). */
export async function findStationForRouteStep(
  tx: TransactionClient,
  itemTypeId: number,
  routeNumber: number,
  currentRouteStep: number
): Promise<number | null> {
  const route = await tx.testing_routes.findFirst({
    where: { item_type_id: itemTypeId, route_number: routeNumber },
    select: { route_steps: true },
  });
  const stationTypeId = route?.route_steps?.[currentRouteStep - 1];
  return stationTypeId == null ? null : findBestStation(tx, { stationTypeId });
}

/** A station of the type with its queue (COUNT → bigint). */
type StationLoadRow = {
  test_station_id: number;
  test_station_desc: string | null;
  waiting_count: bigint;
  in_test_count: bigint;
  total_active: bigint;
};

/** The station of the type (not disabled) with the fewest items waiting, then the fewest waiting or
 *  in test, a random one among equals. Null when the type has no such station at all. */
export async function findLeastWaitingStation(
  tx: Pick<TransactionClient, "$queryRaw">,
  stationTypeId: number,
): Promise<{ test_station_id: number; test_station_desc: string | null } | null> {
  const rows = await tx.$queryRaw<StationLoadRow[]>`
    WITH candidate_stations AS (
      SELECT ts.test_station_id, ts.test_station_desc, ts.test_station_type_id
      FROM test_stations ts
      WHERE ts.test_station_type_id = ${stationTypeId} AND ts.status != ${StationStatus.Disabled}
    ),
    station_load AS (
      SELECT cs.test_station_id, cs.test_station_desc,
             COUNT(CASE WHEN ir.current_status = ${ItemStatus.Queued} AND ir.finished_at IS NULL THEN 1 END) AS waiting_count,
             COUNT(CASE WHEN ir.current_status = ${ItemStatus.InTest} AND ir.finished_at IS NULL THEN 1 END) AS in_test_count
      FROM candidate_stations cs
      LEFT JOIN item_routes ir ON ir.test_station_id = cs.test_station_id AND ir.finished_at IS NULL AND ir.current_status IN (${Prisma.join(AT_STEP_STATUSES)})
      GROUP BY cs.test_station_id, cs.test_station_desc
    )
    SELECT test_station_id, test_station_desc, waiting_count, in_test_count,
           (waiting_count + in_test_count) AS total_active
    FROM station_load
    ORDER BY waiting_count ASC, total_active ASC, test_station_id ASC
  `;
  if (rows.length === 0) return null;
  const waitingOf = (r: StationLoadRow) => Number(r.waiting_count) || 0;
  const activeOf = (r: StationLoadRow) => Number(r.total_active) || 0;
  const fewestWaiting = rows.filter((r) => waitingOf(r) === waitingOf(rows[0]));
  const minActive = Math.min(...fewestWaiting.map(activeOf));
  const tied = fewestWaiting.filter((r) => activeOf(r) === minActive);
  const picked = tied[Math.floor(Math.random() * tied.length)];
  return { test_station_id: picked.test_station_id, test_station_desc: picked.test_station_desc };
}

/** The research station (not disabled) with the fewest items waiting for or in research, a random
 *  one among equals (COUNT → bigint). Null when there is no research station. */
export async function findLeastLoadedResearchStation(tx: Pick<TransactionClient, "$queryRaw">): Promise<{
  test_station_id: number;
  test_station_desc: string | null;
  test_station_type_id: number;
  station_type_name: string;
  current_load: bigint;
} | null> {
  const rows = await tx.$queryRaw<{
    test_station_id: number;
    test_station_desc: string | null;
    test_station_type_id: number;
    station_type_name: string;
    current_load: bigint;
  }[]>`
    WITH research_stations AS (
      SELECT ts.test_station_id, ts.test_station_desc, ts.test_station_type_id,
             COALESCE(tst.test_type_desc, '') AS station_type_name
      FROM test_stations ts
      LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
      WHERE ts.is_research = true AND ts.status != ${StationStatus.Disabled}
    ),
    station_load AS (
      SELECT rs.test_station_id, rs.test_station_desc, rs.test_station_type_id, rs.station_type_name,
             COUNT(CASE WHEN ir.current_status IN (${Prisma.join(RESEARCH_STATUSES)}) AND ir.finished_at IS NULL THEN 1 END) AS current_load
      FROM research_stations rs
      LEFT JOIN item_routes ir ON ir.test_station_id = rs.test_station_id AND ir.finished_at IS NULL AND ir.current_status IN (${Prisma.join(RESEARCH_STATUSES)})
      GROUP BY rs.test_station_id, rs.test_station_desc, rs.test_station_type_id, rs.station_type_name
    )
    SELECT test_station_id, test_station_desc, test_station_type_id, station_type_name, current_load
    FROM station_load
    ORDER BY current_load ASC, RANDOM()
    LIMIT 1
  `;
  return rows[0] ?? null;
}
