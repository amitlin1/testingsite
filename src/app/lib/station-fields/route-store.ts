import { Prisma } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import type { Actor } from "@/lib/auth/identity";
import type { RouteFieldsConfig } from "./schema";
import { ShapeError, parseRouteFieldsConfig } from "./validate";

/**
 * Station fields — a route's stored configs (route-fields spec §3.2): testing_routes.fields_draft
 * and the route_field_versions row of its fields_version, read and written in one place for the
 * admin API, the libraries, the fork and the routes API. SERVER ONLY (prisma).
 *
 * A stored config was saved parsed, so one that does not parse is corrupt data: a real 500
 * (CONFIG_INVALID), never "no fields". So is a fields_version without its row (VERSION_MISSING).
 */

/** Every station-fields transaction: publish counts filled results per removed field (a scan of
 *  test_results) while it holds the routes, and a draft save, a propagate or a fork may wait on it
 *  rather than fail. */
export const STATION_FIELDS_TX = { maxWait: 5_000, timeout: 30_000 } as const;
/** Reads whose parts must agree (the drafts, the routes, the counts): one snapshot. */
export const STATION_FIELDS_READ_TX = {
  ...STATION_FIELDS_TX,
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
} as const;

export type RouteRow = {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
  /** Parallel to route_steps; a different length means the route has no usable uids yet. */
  step_uids: string[];
  /** As stored; null = no draft. */
  fields_draft: unknown;
  draft_rev: number;
  draft_updated_at: Date | null;
  draft_updated_by: string | null;
  /** 0 = never published. */
  fields_version: number;
  item_type_desc: string;
  is_package: boolean;
  /** route_field_versions.config of fields_version, as stored (null when 0, or when the row is missing). */
  published_config: unknown;
  has_version: boolean;
};

const ROUTE_SELECT = Prisma.sql`
  SELECT tr.test_route_id, tr.item_type_id, tr.test_station_type_id, tr.route_number,
         COALESCE(tr.route_steps, '{}') AS route_steps,
         COALESCE(tr.step_uids, '{}') AS step_uids,
         tr.fields_draft, tr.draft_rev, tr.draft_updated_at, tr.draft_updated_by, tr.fields_version,
         TRIM(t.item_type_desc) AS item_type_desc, t.is_package,
         v.config AS published_config, (v.id IS NOT NULL) AS has_version
    FROM testing_routes tr
    JOIN item_types t ON t.item_type_id = tr.item_type_id
    LEFT JOIN route_field_versions v ON v.test_route_id = tr.test_route_id AND v.version = tr.fields_version`;

type Reader = Pick<TransactionClient, "$queryRaw">;

/** One route, optionally locked (FOR UPDATE of the testing_routes row only). */
export async function loadRoute(db: Reader, routeId: number, { lock = false } = {}): Promise<RouteRow | null> {
  const rows = await db.$queryRaw<RouteRow[]>`${ROUTE_SELECT}
     WHERE tr.test_route_id = ${routeId}
     ${lock ? Prisma.sql`FOR UPDATE OF tr` : Prisma.empty}`;
  return rows[0] ?? null;
}

/** The routes `where` names (over tr / t / v), ascending id. */
export function selectRoutes(db: Reader, where: Prisma.Sql): Promise<RouteRow[]> {
  return db.$queryRaw<RouteRow[]>`${ROUTE_SELECT}
     WHERE ${where}
     ORDER BY tr.test_route_id`;
}

/** A config read back from the database (see the module comment). */
export function storedConfig(raw: unknown, routeId: number, what: string): RouteFieldsConfig {
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) {
      throw new HttpError(500, `Route ${routeId}: the stored ${what} does not parse (${e.message})`, { code: "CONFIG_INVALID", extra: {
        route_id: routeId,
      } });
    }
    throw e;
  }
}

/** The route's draft; null when it has none. */
export function readDraft(route: RouteRow): RouteFieldsConfig | null {
  return route.fields_draft == null ? null : storedConfig(route.fields_draft, route.test_route_id, "draft");
}

/** The config of the route's latest published version; null when it was never published. */
export function readPublished(route: RouteRow): RouteFieldsConfig | null {
  if (route.fields_version < 1) return null;
  if (!route.has_version) {
    throw new HttpError(500, `Route ${route.test_route_id} points at version ${route.fields_version}, which does not exist`, { code: "VERSION_MISSING", extra: {
      route_id: route.test_route_id,
    } });
  }
  return storedConfig(route.published_config, route.test_route_id, `version ${route.fields_version}`);
}

/**
 * Stores the route's draft (null = discard it) and bumps draft_rev. The draft is a parsed config;
 * a discarded one is SQL NULL, never a JSON null: `fields_draft IS NULL` is how every reader tells
 * "no draft".
 */
export async function writeDraft(
  tx: Reader,
  routeId: number,
  config: RouteFieldsConfig | null,
  actor: Actor,
): Promise<{ draft_rev: number; draft_updated_at: Date }> {
  const draft = config === null ? Prisma.sql`NULL` : Prisma.sql`${JSON.stringify(config)}::jsonb`;
  const rows = await tx.$queryRaw<{ draft_rev: number; draft_updated_at: Date }[]>`
    UPDATE testing_routes
       SET fields_draft = ${draft},
           draft_rev = draft_rev + 1,
           draft_updated_at = now(),
           draft_updated_by = ${actor.username}
     WHERE test_route_id = ${routeId}
    RETURNING draft_rev, draft_updated_at`;
  return rows[0];
}
