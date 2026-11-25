import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { isDbId, parseDbId } from "@/lib/http/request";
import { templateSeqRanges } from "@/app/lib/packages/template-wire";
import { getRouteFields } from "./admin";
import { ROUTE_MISSING } from "./admin-types";
import type { FieldsContextJson, RouteFieldsJson, StationTypeJson } from "./admin-types";
import { STATION_FIELDS_READ_TX } from "./route-store";

/**
 * Station fields — the one read the fields map is built from (route-fields spec §3.2
 * "fields-context", §5.4.6, §5.17):
 *   ?packageTypeId=&routeNumber=  → kind "package": the kit's own route, plus every
 *                                   package_contents line with the item route it runs (the
 *                                   line's route_number, not the kit's)
 *   ?itemTypeId=&routeNumber=     → kind "item": the one item route, no lines
 *
 * SERVER ONLY (prisma). GET /api/settings/testing-routes/fields-context is a thin handler over
 * buildFieldsContext, which answers FieldsContextJson (admin-types.ts).
 *
 * Every route is exactly getRouteFields' payload (GET …/[id]/fields), read once per distinct
 * route. A route that does not exist is null with its reason (ROUTE_MISSING); every failure is a
 * real error, never an empty context (artboard 11: a route that could not be read must not look
 * like a route without fields). All reads share one REPEATABLE READ snapshot, so the lines, the
 * routes and their drafts agree with each other.
 *
 * Errors — HttpError:
 *   400 INVALID_QUERY — not exactly one of packageTypeId / itemTypeId, no routeNumber, or a value
 *       that is not an int4 ≥ 1
 *   400 NOT_A_PACKAGE_TYPE {item_type_id} — packageTypeId names a type that is not a kit
 *   400 IS_A_PACKAGE_TYPE {item_type_id} — itemTypeId names a kit (its context is packageTypeId's)
 *   404 ITEM_TYPE_NOT_FOUND {item_type_id}
 *   500 CONFIG_INVALID / VERSION_MISSING — a stored config getRouteFields cannot read
 */

// ---- request helpers ----------------------------------------------------------------------------
/** The query as numbers: null = not given, NaN = given but not a row id (see fieldsContextQuery). */
type FieldsContextQuery = {
  packageTypeId?: number | null;
  itemTypeId?: number | null;
  routeNumber?: number | null;
};

/** The search params as FieldsContextQuery: an absent or empty parameter is null, anything that
 *  cannot be a row id NaN — buildFieldsContext answers 400 for it. */
export function fieldsContextQuery(params: URLSearchParams): FieldsContextQuery {
  const read = (name: string): number | null => {
    const raw = params.get(name);
    return raw === null || raw === "" ? null : parseDbId(raw) ?? Number.NaN;
  };
  return { packageTypeId: read("packageTypeId"), itemTypeId: read("itemTypeId"), routeNumber: read("routeNumber") };
}

function badQuery(message: string): HttpError {
  return new HttpError(400, message, { code: "INVALID_QUERY" });
}

function idOf(raw: number | null | undefined, name: string): number {
  if (!isDbId(raw)) throw badQuery(`${name} must be a positive integer`);
  return raw;
}

// ---- loading ------------------------------------------------------------------------------------
type LineRow = {
  line_id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  sort_order: number;
  route_number: number;
};

/** The template lines, in the intake's order (sort_order, then id), with the package_seq range each
 *  one's units take (templateSeqRanges). */
async function loadLines(db: TransactionClient, packageTypeId: number): Promise<(LineRow & { seq_from: number; seq_to: number })[]> {
  const rows = await db.$queryRaw<LineRow[]>`
    SELECT pc.id AS line_id, pc.item_type_id, TRIM(t.item_type_desc) AS item_type_desc,
           pc.quantity, pc.sort_order, pc.route_number
      FROM package_contents pc
      JOIN item_types t ON t.item_type_id = pc.item_type_id
     WHERE pc.package_type_id = ${packageTypeId}
     ORDER BY pc.sort_order ASC, pc.id ASC`;
  return templateSeqRanges(rows);
}

/** Every station type, keyed by id. */
async function loadStations(db: TransactionClient): Promise<Record<number, StationTypeJson>> {
  const rows = await db.$queryRaw<{ test_station_type_id: number; label: string; package_level: boolean }[]>`
    SELECT test_station_type_id, TRIM(test_type_desc) AS label, package_level
      FROM test_stations_type
     ORDER BY test_station_type_id`;
  const out: Record<number, StationTypeJson> = {};
  for (const r of rows) out[r.test_station_type_id] = { label: r.label, package_level: r.package_level };
  return out;
}

const routeKey = (itemTypeId: number, routeNumber: number) => `${itemTypeId}:${routeNumber}`;

/** test_route_id of each (item_type_id, route_number) that has a route (unique pair). */
async function routeIdsByKey(
  db: TransactionClient,
  pairs: readonly { item_type_id: number; route_number: number }[],
): Promise<Map<string, number>> {
  const rows = await db.testing_routes.findMany({
    where: { OR: pairs.map((p) => ({ item_type_id: p.item_type_id, route_number: p.route_number })) },
    select: { test_route_id: true, item_type_id: true, route_number: true },
  });
  return new Map(rows.map((r) => [routeKey(r.item_type_id, r.route_number), r.test_route_id]));
}

// ---- endpoint -----------------------------------------------------------------------------------
/** GET /api/settings/testing-routes/fields-context (spec §3.2). */
export async function buildFieldsContext(db: PrismaClient, query: FieldsContextQuery): Promise<FieldsContextJson> {
  const givenPackage = query.packageTypeId != null;
  const givenItem = query.itemTypeId != null;
  if (givenPackage === givenItem) throw badQuery("Give exactly one of packageTypeId and itemTypeId");
  if (query.routeNumber == null) throw badQuery("routeNumber is required");
  const kind: FieldsContextJson["kind"] = givenPackage ? "package" : "item";
  const typeId = givenPackage ? idOf(query.packageTypeId, "packageTypeId") : idOf(query.itemTypeId, "itemTypeId");
  const routeNumber = idOf(query.routeNumber, "routeNumber");

  return db.$transaction(async (tx) => {
    const [type] = await tx.$queryRaw<{ item_type_id: number; item_type_desc: string; is_package: boolean }[]>`
      SELECT item_type_id, TRIM(item_type_desc) AS item_type_desc, is_package
        FROM item_types
       WHERE item_type_id = ${typeId}`;
    if (!type) {
      throw new HttpError(404, `Item type ${typeId} not found`, { code: "ITEM_TYPE_NOT_FOUND", extra: { item_type_id: typeId } });
    }
    if (kind === "package" && !type.is_package) {
      throw new HttpError(400, `Item type ${typeId} is not a package type`, { code: "NOT_A_PACKAGE_TYPE", extra: { item_type_id: typeId } });
    }
    if (kind === "item" && type.is_package) {
      throw new HttpError(400, `Item type ${typeId} is a package type: ask with packageTypeId`, { code: "IS_A_PACKAGE_TYPE", extra: {
        item_type_id: typeId,
      } });
    }

    const stations = await loadStations(tx);
    const lines = kind === "package" ? await loadLines(tx, typeId) : [];
    const ids = await routeIdsByKey(tx, [{ item_type_id: typeId, route_number: routeNumber }, ...lines]);

    // One getRouteFields per distinct route, whichever members of the context name it.
    const views = new Map<number, RouteFieldsJson>();
    const routeOf = async (itemTypeId: number, number: number): Promise<RouteFieldsJson | null> => {
      const id = ids.get(routeKey(itemTypeId, number));
      if (id === undefined) return null;
      let view = views.get(id);
      if (!view) {
        view = await getRouteFields(tx, id);
        views.set(id, view);
      }
      return view;
    };

    const own = await routeOf(typeId, routeNumber);
    const context: FieldsContextJson = {
      kind,
      subject: { item_type_id: type.item_type_id, desc: type.item_type_desc, is_package: type.is_package, route_number: routeNumber },
      stations,
      kit: kind === "package" ? own : null,
      item: kind === "item" ? own : null,
      lines: [],
    };
    if (!own) {
      if (kind === "package") context.kit_missing = ROUTE_MISSING;
      else context.item_missing = ROUTE_MISSING;
    }
    for (const l of lines) {
      const route = await routeOf(l.item_type_id, l.route_number);
      context.lines.push({
        line_id: l.line_id,
        item_type_id: l.item_type_id,
        item_type_desc: l.item_type_desc,
        quantity: l.quantity,
        sort_order: l.sort_order,
        seq_from: l.seq_from,
        seq_to: l.seq_to,
        route_number: l.route_number,
        route,
        ...(route ? {} : { missing: ROUTE_MISSING }),
      });
    }
    return context;
  }, STATION_FIELDS_READ_TX);
}
