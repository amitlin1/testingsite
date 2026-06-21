import { TransactionClient } from "./prisma";

/**
 * Finds the best station to assign an item to, based on station type.
 *
 * Logic:
 * 1. First, look for a FREE station (status = 2) of the given type.
 * 2. If no free station, find the ACTIVE station (status = 1) with the fewest items in queue.
 * 3. Never assign to disabled stations (status = 3).
 *
 * @param tx - A Prisma transaction client
 * @param stationTypeId - The station TYPE to look for (from route_steps[current_route_step])
 * @returns The test_station_id of the best station, or null if none found
 */
export async function findBestStation(
  tx: TransactionClient,
  stationTypeId: number
): Promise<number | null> {
  // Step 1: Try to find a free station (status = 2)
  const freeResult = await tx.test_stations.findFirst({
    where: {
      test_station_type_id: stationTypeId,
      status: 2,
    },
    select: { test_station_id: true },
  });
  if (freeResult) {
    return freeResult.test_station_id;
  }

  // Step 2: No free station — find the active station (status = 1) with fewest items in queue
  const leastLoaded: { test_station_id: number }[] = await tx.$queryRaw`
    SELECT ts.test_station_id
    FROM test_stations ts
    LEFT JOIN (
      SELECT test_station_id, COUNT(*) AS queue_count
      FROM item_routes
      WHERE current_status IN (2, 4) AND finished_at IS NULL
      GROUP BY test_station_id
    ) ir ON ir.test_station_id = ts.test_station_id
    WHERE ts.test_station_type_id = ${stationTypeId} AND ts.status = 1
    ORDER BY COALESCE(ir.queue_count, 0) ASC
    LIMIT 1
  `;
  if (leastLoaded.length > 0) {
    return leastLoaded[0].test_station_id;
  }

  return null;
}

/**
 * Finds the best RESEARCH station to assign an item to.
 * Same logic as findBestStation but filters by is_research = true instead of station type.
 *
 * @param tx - A Prisma transaction client
 * @returns The test_station_id of the best research station, or null if none found
 */
export async function findBestResearchStation(
  tx: TransactionClient
): Promise<number | null> {
  // Step 1: Try to find a free research station (status = 2)
  const freeResult = await tx.test_stations.findFirst({
    where: {
      is_research: true,
      status: 2,
    },
    select: { test_station_id: true },
  });
  if (freeResult) {
    return freeResult.test_station_id;
  }

  // Step 2: No free station — find the active research station (status = 1) with fewest items in queue
  const leastLoaded: { test_station_id: number }[] = await tx.$queryRaw`
    SELECT ts.test_station_id
    FROM test_stations ts
    LEFT JOIN (
      SELECT test_station_id, COUNT(*) AS queue_count
      FROM item_routes
      WHERE current_status IN (2, 4) AND finished_at IS NULL
      GROUP BY test_station_id
    ) ir ON ir.test_station_id = ts.test_station_id
    WHERE ts.is_research = true AND ts.status = 1
    ORDER BY COALESCE(ir.queue_count, 0) ASC
    LIMIT 1
  `;
  if (leastLoaded.length > 0) {
    return leastLoaded[0].test_station_id;
  }

  return null;
}

/**
 * Determines the station type for a given item based on its route and current step,
 * then finds the best station of that type.
 *
 * @param tx - A Prisma transaction client
 * @param itemTypeId - The item's type ID
 * @param routeNumber - The item's route number
 * @param currentRouteStep - The item's current route step (1-indexed)
 * @returns The test_station_id of the best station, or null if none found
 */
export async function findStationForRouteStep(
  tx: TransactionClient,
  itemTypeId: number,
  routeNumber: number,
  currentRouteStep: number
): Promise<number | null> {
  // Get route_steps array
  const route = await tx.testing_routes.findFirst({
    where: {
      item_type_id: itemTypeId,
      route_number: routeNumber,
    },
    select: { route_steps: true },
  });

  if (!route) {
    return null;
  }

  const routeSteps: number[] = route.route_steps;
  if (!routeSteps || routeSteps.length === 0) {
    return null;
  }

  // currentRouteStep is 1-indexed, JS array is 0-indexed
  const stepIndex = currentRouteStep - 1;
  if (stepIndex < 0 || stepIndex >= routeSteps.length) {
    return null; // Step out of bounds (item finished route)
  }

  const stationTypeId = routeSteps[stepIndex];
  return findBestStation(tx, stationTypeId);
}
