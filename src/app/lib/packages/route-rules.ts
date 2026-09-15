import { TransactionClient } from "@/app/lib/prisma";

/**
 * Route-shape rules of the package model — docs/packages/PLAN.md §4.
 *
 * A package route starts and ends at a package-level station type (opening,
 * closing) and has no package-level step in between. The route of every item
 * type inside the package starts at the SAME opening type and ends at the SAME
 * closing type: the first rule is what keeps an item hidden until its box is
 * opened (package-level stations never list items), the second is what makes
 * the items meet the box again at closing.
 *
 * The settings screen reports violations as warnings (a template can be saved
 * before its routes exist); package creation enforces them.
 */

export type RouteShape = {
  itemTypeId: number;
  routeNumber: number;
  steps: number[];
};

/** Any DB handle that can run the two reads below — the live client or a tx. */
type Reader = Pick<TransactionClient, "testing_routes" | "test_stations_type">;

export async function loadRouteShape(
  db: Reader,
  itemTypeId: number,
  routeNumber: number,
): Promise<RouteShape | null> {
  const row = await db.testing_routes.findFirst({
    where: { item_type_id: itemTypeId, route_number: routeNumber },
    select: { route_steps: true },
  });
  if (!row) return null;
  return { itemTypeId, routeNumber, steps: row.route_steps ?? [] };
}

export async function loadPackageLevelTypeIds(db: Reader): Promise<Set<number>> {
  const rows = await db.test_stations_type.findMany({
    where: { package_level: true },
    select: { test_station_type_id: true },
  });
  return new Set(rows.map((r) => r.test_station_type_id));
}

export function firstStep(shape: RouteShape): number | null {
  return shape.steps.length > 0 ? shape.steps[0] : null;
}

export function lastStep(shape: RouteShape): number | null {
  return shape.steps.length > 0 ? shape.steps[shape.steps.length - 1] : null;
}

/** null when the package route is well-formed, otherwise the Hebrew reason. */
export function checkPackageRoute(shape: RouteShape | null, packageLevel: Set<number>, routeNumber: number): string | null {
  if (!shape) return `לסוג המארז אין מסלול מספר ${routeNumber}`;
  if (shape.steps.length === 0) return "מסלול המארז ריק";
  const first = firstStep(shape)!;
  const last = lastStep(shape)!;
  if (!packageLevel.has(first)) return "השלב הראשון של מסלול המארז חייב להיות עמדה ברמת מארז (פתיחת מארז)";
  if (!packageLevel.has(last)) return "השלב האחרון של מסלול המארז חייב להיות עמדה ברמת מארז (סגירת מארז)";
  if (shape.steps.slice(1, -1).some((s) => packageLevel.has(s))) {
    return "מסלול המארז לא יכול לכלול עמדה ברמת מארז באמצע המסלול";
  }
  return null;
}

/** null when the item route fits the package route, otherwise the Hebrew reason. */
export function checkItemRouteAgainstPackage(
  item: RouteShape | null,
  pkg: RouteShape,
  packageLevel: Set<number>,
  routeNumber: number,
): string | null {
  if (!item) return `לסוג הפריט אין מסלול מספר ${routeNumber}`;
  if (item.steps.length === 0) return "מסלול הפריט ריק";
  if (firstStep(item) !== firstStep(pkg)) return "מסלול הפריט חייב להתחיל באותה עמדת פתיחה כמו מסלול המארז";
  if (lastStep(item) !== lastStep(pkg)) return "מסלול הפריט חייב להסתיים באותה עמדת סגירה כמו מסלול המארז";
  if (item.steps.slice(1, -1).some((s) => packageLevel.has(s))) {
    return "מסלול הפריט לא יכול לכלול עמדה ברמת מארז באמצע המסלול";
  }
  return null;
}
