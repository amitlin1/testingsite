import { Prisma } from "@prisma/client";
import { ItemStatus } from "@/lib/item-status";

/**
 * The testing screen's queue rule: does a station's queue list this routed
 * row? One SQL condition for every query that has to agree with the queue —
 * /api/testing/items builds the queue with it, /api/search/items finds the
 * station whose queue an item shows up in.
 *
 *   in test (1)            at the station it is in test at
 *   queued (2)             at every station of its current step's type
 *   in research (5)        at the research station it is at
 *   waiting for research (4)  at every research station
 *
 * never once its route finished, and a package-level station (opening,
 * closing) lists boxes only — the items inside a box are tested with it.
 *
 * The arguments are SQL expressions of the caller's query (aliases, columns).
 */
export type QueueRuleSql = {
  /** The item_routes row. */
  route: string;
  /** The items row (its package_id). */
  item: string;
  /** The station's id, test_station_type_id, is_research and its type's package_level. */
  stationId: Prisma.Sql;
  stationTypeId: Prisma.Sql;
  stationIsResearch: Prisma.Sql;
  stationPackageLevel: Prisma.Sql;
  /** The station type of the row's current route step. */
  currentStepTypeId: Prisma.Sql;
};

export function listedAtStation(q: QueueRuleSql): Prisma.Sql {
  const route = Prisma.raw(q.route);
  const item = Prisma.raw(q.item);
  return Prisma.sql`(
    (COALESCE(${q.stationPackageLevel}, false) = false OR ${item}.package_id IS NULL)
    AND ${route}.finished_at IS NULL
    AND (
         (${route}.current_status = ${ItemStatus.InTest} AND ${route}.test_station_id = ${q.stationId})
      OR (${route}.current_status = ${ItemStatus.Queued} AND ${q.currentStepTypeId} = ${q.stationTypeId})
      OR (${q.stationIsResearch} = true AND ${route}.current_status = ${ItemStatus.InResearch} AND ${route}.test_station_id = ${q.stationId})
      OR (${q.stationIsResearch} = true AND ${route}.current_status = ${ItemStatus.AwaitResearch})
    )
  )`;
}
