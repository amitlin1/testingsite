/**
 * The variable catalog of a route's report template (server side).
 *
 * The template of an item route can bind:
 *   - the steps of the route itself (its "item" groups), and
 *   - the package-level steps (opening / closing) of every kit that runs this
 *     route (package_contents line with this item type + route number) — an
 *     item's row at such a step carries the KIT route's step uid, and answers
 *     the kit's "each_item" + its own type group.
 * Fields come from the route's draft when there is one (the admin is about to
 * publish it), else its latest published version.
 */
import type { TransactionClient } from "@/app/lib/prisma";
import { parseRouteFieldsConfig, ShapeError } from "@/app/lib/station-fields/validate";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { buildCatalog } from "./variables";
import type { CatalogRoute, CatalogStationTypes } from "./variables";
import type { ReportStepRef, ReportVar } from "./types";

type Db = TransactionClient;

type RouteRow = {
  test_route_id: number;
  item_type_id: number;
  route_number: number;
  route_steps: number[];
  step_uids: string[];
  fields_draft: unknown;
  fields_version: number;
};

function parse(raw: unknown): RouteFieldsConfig | null {
  if (raw == null) return null;
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) return null; // an unreadable config → the steps without fields
    throw e;
  }
}

async function configOf(db: Db, r: RouteRow): Promise<RouteFieldsConfig | null> {
  const draft = parse(r.fields_draft);
  if (draft) return draft;
  if (r.fields_version < 1) return null;
  const v = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: r.test_route_id, version: r.fields_version } },
    select: { config: true },
  });
  return v ? parse(v.config) : null;
}

const ROUTE_SELECT = {
  test_route_id: true, item_type_id: true, route_number: true, route_steps: true,
  step_uids: true, fields_draft: true, fields_version: true,
} as const;

export async function loadStationTypes(db: Db): Promise<CatalogStationTypes> {
  const rows = await db.test_stations_type.findMany({
    select: { test_station_type_id: true, test_type_desc: true, package_level: true },
  });
  const out: CatalogStationTypes = {};
  for (const r of rows) out[r.test_station_type_id] = { label: r.test_type_desc.trim(), package_level: r.package_level };
  return out;
}

export type RouteCatalog = {
  route: { test_route_id: number; item_type_id: number; item_type_desc: string; route_number: number; is_package: boolean };
  vars: ReportVar[];
  steps: ReportStepRef[];
};

/** null when the route does not exist. */
export async function loadRouteCatalog(db: Db, testRouteId: number): Promise<RouteCatalog | null> {
  const route = await db.testing_routes.findUnique({
    where: { test_route_id: testRouteId },
    select: { ...ROUTE_SELECT, item_types: { select: { item_type_desc: true, is_package: true } } },
  });
  if (!route) return null;
  const stationTypes = await loadStationTypes(db);

  const routes: CatalogRoute[] = [{
    label: `מסלול ${route.route_number}`,
    kind: "item",
    item_type_id: route.item_type_id,
    route_steps: route.route_steps,
    step_uids: route.step_uids,
    config: await configOf(db, route),
  }];

  // Kits whose template runs this route → every route of those kit types.
  const lines = await db.package_contents.findMany({
    where: { item_type_id: route.item_type_id, route_number: route.route_number },
    select: { package_type_id: true, package_type: { select: { item_type_desc: true } } },
    orderBy: { package_type_id: "asc" },
  });
  for (const line of lines) {
    const kitRoutes = await db.testing_routes.findMany({
      where: { item_type_id: line.package_type_id },
      select: ROUTE_SELECT,
      orderBy: { route_number: "asc" },
    });
    for (const kr of kitRoutes) {
      routes.push({
        label: `${line.package_type.item_type_desc.trim()} · מסלול ${kr.route_number}`,
        kind: "kit",
        item_type_id: route.item_type_id,
        route_steps: kr.route_steps,
        step_uids: kr.step_uids,
        config: await configOf(db, kr),
      });
    }
  }

  const { vars, steps } = buildCatalog(routes, stationTypes);
  return {
    route: {
      test_route_id: route.test_route_id,
      item_type_id: route.item_type_id,
      item_type_desc: route.item_types.item_type_desc.trim(),
      route_number: route.route_number,
      is_package: route.item_types.is_package,
    },
    vars,
    steps,
  };
}
