import type {
  ContextLineJson, FieldsContextJson, RouteFieldsJson, SharedKitJson, StationTypeJson,
} from "@/app/lib/station-fields/admin-types";
import type { StepUid } from "@/app/lib/station-fields/schema";

/**
 * Queries over GET …/fields-context (a kit's context: its own route and one item route per template
 * line). Pure — the map, the draft store, the publish dialog, the header and the steps tab read the
 * context through these.
 */

/** The template lines in map order: sort_order, then line id. */
export function sortedLines(ctx: FieldsContextJson): ContextLineJson[] {
  return [...ctx.lines].sort((a, z) => a.sort_order - z.sort_order || a.line_id - z.line_id);
}

/** The routes of a context: the kit's own, then each line's in map order — each route once (two
 *  lines may run the same route). */
export function contextRoutes(ctx: FieldsContextJson): RouteFieldsJson[] {
  const out: RouteFieldsJson[] = [];
  const seen = new Set<number>();
  const add = (r: RouteFieldsJson | null) => {
    if (r && !seen.has(r.route.test_route_id)) {
      seen.add(r.route.test_route_id);
      out.push(r);
    }
  };
  add(ctx.kit);
  for (const l of sortedLines(ctx)) add(l.route);
  return out;
}

export function contextRouteIds(ctx: FieldsContextJson): number[] {
  return contextRoutes(ctx).map((r) => r.route.test_route_id);
}

/** The kit's own route id, or null when the kit has no route yet. */
export function ownRouteId(ctx: FieldsContextJson): number | null {
  return ctx.kit?.route.test_route_id ?? null;
}

/** The kit on screen: its package type id. */
export function kitIdOf(ctx: FieldsContextJson): number {
  return ctx.subject.item_type_id;
}

/** The kits that run a route, other than the one on screen. */
export function otherKits(sharedWith: readonly SharedKitJson[], kitId: number): SharedKitJson[] {
  return sharedWith.filter((k) => k.package_type_id !== kitId);
}

/** Station type ids with package_level, ascending. */
export function packageLevelIds(ctx: FieldsContextJson): number[] {
  return Object.entries(ctx.stations)
    .filter(([, s]) => s.package_level)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
}

/** A station type's name; `ID {n}` for a type the list does not have. */
export function stationLabel(stations: Readonly<Record<number, StationTypeJson>>, typeId: number): string {
  return stations[typeId]?.label?.trim() || `ID ${typeId}`;
}

/** The steps of a route as the database pairs them: step_uids[i] is the uid of route_steps[i] — and
 *  only when the two arrays line up (a route a script inserted has no usable uids: every uid null). */
export function alignedStepUids(route: { route_steps: readonly number[]; step_uids?: readonly string[] | null }): (StepUid | null)[] {
  const uids = Array.isArray(route.step_uids) && route.step_uids.length === route.route_steps.length ? route.step_uids : null;
  return route.route_steps.map((_, i) => (uids ? uids[i] || null : null));
}

/** The same steps: route_steps and step_uids alike, in order. */
export function sameSteps(a: RouteFieldsJson["route"], b: RouteFieldsJson["route"]): boolean {
  return a.route_steps.length === b.route_steps.length && a.route_steps.every((t, i) => t === b.route_steps[i])
    && a.step_uids.length === b.step_uids.length && a.step_uids.every((u, i) => u === b.step_uids[i]);
}

/** The item a route is about: the kit for its own route, else the first template line that runs it. */
export function routeOwnerLabel(ctx: FieldsContextJson, routeId: number): string {
  if (ownRouteId(ctx) === routeId) return ctx.subject.desc;
  const line = sortedLines(ctx).find((l) => l.route?.route.test_route_id === routeId);
  return line ? line.item_type_desc : ctx.subject.desc;
}

/**
 * The row the screen's "version N" names (spec §10.2-4): the route on screen's own, else — only item routes are in
 * play — the newest of `rows`. null when there are none.
 */
export function ownOrNewest<T>(rows: readonly T[], ownId: number | null, idOf: (r: T) => number, versionOf: (r: T) => number): T | null {
  const own = ownId == null ? undefined : rows.find((r) => idOf(r) === ownId);
  if (own !== undefined) return own;
  return rows.reduce<T | null>((best, r) => (best == null || versionOf(r) > versionOf(best) ? r : best), null);
}
