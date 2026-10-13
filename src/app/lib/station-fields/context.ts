import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/app/lib/prisma";
import { AdminFieldsError, getRouteFields, parsePathId } from "./admin";
import type { RouteFieldsView } from "./admin";
import { ROUTE_MISSING } from "./admin-types";

/**
 * Station fields — the one read the fields map is built from (route-fields spec §3.2
 * "fields-context", §5.4.6, §5.17):
 *   ?packageTypeId=&routeNumber=  → kind "package": the kit's own route, plus every
 *                                   package_contents line with the item route it runs (the
 *                                   line's route_number, not the kit's)
 *   ?itemTypeId=&routeNumber=     → kind "item": the one item route, no lines
 *
 * SERVER ONLY (prisma). GET /api/settings/testing-routes/fields-context is a thin handler over
 * buildFieldsContext. FieldsContext is the wire shape FieldsContextJson (admin-types.ts) before
 * JSON — the same members, Dates where the wire has ISO strings.
 *
 * Every route is exactly getRouteFields' payload (GET …/[id]/fields), read once per distinct
 * route. A route that does not exist is null with its reason (ROUTE_MISSING); every failure is a
 * real error, never an empty context (artboard 11: a route that could not be read must not look
 * like a route without fields). All reads share one REPEATABLE READ snapshot, so the lines, the
 * routes and their drafts agree with each other.
 *
 * Errors — AdminFieldsError, answered by adminFieldsErrorResponse:
 *   400 INVALID_QUERY — not exactly one of packageTypeId / itemTypeId, no routeNumber, or a value
 *       that is not an int4 ≥ 1
 *   400 NOT_A_PACKAGE_TYPE {item_type_id} — packageTypeId names a type that is not a kit
 *   400 IS_A_PACKAGE_TYPE {item_type_id} — itemTypeId names a kit (its context is packageTypeId's)
 *   404 ITEM_TYPE_NOT_FOUND {item_type_id}
 *   500 CONFIG_INVALID / VERSION_MISSING — a stored config getRouteFields cannot read
 */

// ---- types ----------------------------------------------------------------------------------
/** Why a route of the context is null: no testing_routes row for (item_type_id, route_number). */
export { ROUTE_MISSING };

/** A station type as the map labels it: TRIM(test_type_desc), and whether it is package-level. */
export type StationTypeView = { label: string; package_level: boolean };

/** One package_contents line of the kit, in sort_order, with the item route it runs. */
export type FieldsContextLine = {
  line_id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  sort_order: number;
  /** The package_seq range this line's units take in a kit opened from the template. */
  seq_from: number;
  seq_to: number;
  route_number: number;
  /** The item route (item_type_id, route_number); null when it does not exist. */
  route: RouteFieldsView | null;
  /** Why `route` is null. */
  missing?: string;
};

export type FieldsContext = {
  kind: "package" | "item";
  subject: { item_type_id: number; desc: string; is_package: boolean; route_number: number };
  /** Every station type, by test_station_type_id. */
  stations: Record<number, StationTypeView>;
  /** kind "package": the kit's own route (null + kit_missing when it does not exist). */
  kit: RouteFieldsView | null;
  kit_missing?: string;
  /** kind "item": the item route (null + item_missing when it does not exist). */
  item: RouteFieldsView | null;
  item_missing?: string;
  /** kind "package": the template lines; kind "item": []. */
  lines: FieldsContextLine[];
};

/** The query as numbers: null = not given, NaN = given but not digits (see fieldsContextQuery). */
export type FieldsContextQuery = {
  packageTypeId?: number | null;
  itemTypeId?: number | null;
  routeNumber?: number | null;
};

// ---- request helpers ----------------------------------------------------------------------------
/** The search params as FieldsContextQuery: an absent or empty parameter is null, anything but
 *  digits NaN — buildFieldsContext answers 400 for it. */
export function fieldsContextQuery(params: URLSearchParams): FieldsContextQuery {
  const read = (name: string): number | null => {
    const raw = params.get(name);
    return raw === null || raw === "" ? null : parsePathId(raw);
  };
  return { packageTypeId: read("packageTypeId"), itemTypeId: read("itemTypeId"), routeNumber: read("routeNumber") };
}

/** Item type ids and route numbers are int4 columns, as admin.ts checks them: a larger number can
 *  name no row, and Postgres would refuse it as a parameter (a 500) rather than find nothing. */
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

function badQuery(message: string): AdminFieldsError {
  return new AdminFieldsError(400, "INVALID_QUERY", message);
}

function idOf(raw: number | null | undefined, name: string): number {
  if (!isId(raw)) throw badQuery(`${name} must be a positive integer`);
  return raw;
}

/** Reads of a context run a few queries per route; the same bounds as admin.ts's transactions. */
const TX_OPTIONS = {
  maxWait: 5_000,
  timeout: 30_000,
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
} as const;

// ---- loading ------------------------------------------------------------------------------------
type LineRow = {
  line_id: number;
  item_type_id: number;
  item_type_desc: string;
  quantity: number;
  sort_order: number;
  route_number: number;
};

/**
 * The template lines with the package_seq range each one's units take — exactly how intake numbers
 * them: the intake form lays the lines out in this order (sort_order, then id — the order of
 * GET /api/settings/item-types/[id]/contents and of createPackage's own template read), each line
 * max(1, quantity) rows, and createPackage gives the n-th row package_seq n.
 */
async function loadLines(db: TransactionClient, packageTypeId: number): Promise<(LineRow & { seq_from: number; seq_to: number })[]> {
  const rows = await db.$queryRaw<LineRow[]>`
    SELECT pc.id AS line_id, pc.item_type_id, TRIM(t.item_type_desc) AS item_type_desc,
           pc.quantity, pc.sort_order, pc.route_number
      FROM package_contents pc
      JOIN item_types t ON t.item_type_id = pc.item_type_id
     WHERE pc.package_type_id = ${packageTypeId}
     ORDER BY pc.sort_order ASC, pc.id ASC`;
  let next = 1;
  return rows.map((r) => {
    const seqFrom = next;
    next += Math.max(1, r.quantity);
    return { ...r, seq_from: seqFrom, seq_to: next - 1 };
  });
}

/** Every station type, keyed by id. */
async function loadStations(db: TransactionClient): Promise<Record<number, StationTypeView>> {
  const rows = await db.$queryRaw<{ test_station_type_id: number; label: string; package_level: boolean }[]>`
    SELECT test_station_type_id, TRIM(test_type_desc) AS label, package_level
      FROM test_stations_type
     ORDER BY test_station_type_id`;
  const out: Record<number, StationTypeView> = {};
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
export async function buildFieldsContext(db: PrismaClient, query: FieldsContextQuery): Promise<FieldsContext> {
  const givenPackage = query.packageTypeId != null;
  const givenItem = query.itemTypeId != null;
  if (givenPackage === givenItem) throw badQuery("Give exactly one of packageTypeId and itemTypeId");
  if (query.routeNumber == null) throw badQuery("routeNumber is required");
  const kind: FieldsContext["kind"] = givenPackage ? "package" : "item";
  const typeId = givenPackage ? idOf(query.packageTypeId, "packageTypeId") : idOf(query.itemTypeId, "itemTypeId");
  const routeNumber = idOf(query.routeNumber, "routeNumber");

  return db.$transaction(async (tx) => {
    const [type] = await tx.$queryRaw<{ item_type_id: number; item_type_desc: string; is_package: boolean }[]>`
      SELECT item_type_id, TRIM(item_type_desc) AS item_type_desc, is_package
        FROM item_types
       WHERE item_type_id = ${typeId}`;
    if (!type) {
      throw new AdminFieldsError(404, "ITEM_TYPE_NOT_FOUND", `Item type ${typeId} not found`, { item_type_id: typeId });
    }
    if (kind === "package" && !type.is_package) {
      throw new AdminFieldsError(400, "NOT_A_PACKAGE_TYPE", `Item type ${typeId} is not a package type`, { item_type_id: typeId });
    }
    if (kind === "item" && type.is_package) {
      throw new AdminFieldsError(400, "IS_A_PACKAGE_TYPE", `Item type ${typeId} is a package type: ask with packageTypeId`, {
        item_type_id: typeId,
      });
    }

    const stations = await loadStations(tx);
    const lines = kind === "package" ? await loadLines(tx, typeId) : [];
    const ids = await routeIdsByKey(tx, [{ item_type_id: typeId, route_number: routeNumber }, ...lines]);

    // One getRouteFields per distinct route, whichever members of the context name it.
    const views = new Map<number, RouteFieldsView>();
    const routeOf = async (itemTypeId: number, number: number): Promise<RouteFieldsView | null> => {
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
    const context: FieldsContext = {
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
  }, TX_OPTIONS);
}
