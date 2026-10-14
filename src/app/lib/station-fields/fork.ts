import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/app/lib/prisma";
import {
  checkItemRouteAgainstPackage,
  checkPackageRoute,
  loadPackageLevelTypeIds,
  loadRouteShape,
} from "@/app/lib/packages/route-rules";
import type { RouteShape } from "@/app/lib/packages/route-rules";
import { AdminFieldsError } from "./admin";
import type { Actor } from "./admin";
import type { ForkResultJson } from "./admin-types";
import type { RouteFieldsConfig } from "./schema";
import { ShapeError, parseRouteFieldsConfig } from "./validate";

/**
 * Station fields — "צור מסלול נפרד למארז הזה" (route-fields spec §3.2.1, decision 4; artboard 2):
 * the fields of a per-item step live on the ITEM's route, which every kit whose template runs that
 * route shares. A fork gives one kit's template line a route of its own, with the same steps and
 * the same fields, so its cells stop being shared.
 *
 * POST /api/settings/testing-routes/[id]/fork { package_type_id } → { test_route_id, route_number },
 * in ONE transaction:
 *   1. the source route is locked (FOR UPDATE);
 *   2. the new route_number is max(route_number) + 1 of the source's item type — forks of one item
 *      type queue on a transaction advisory lock, so two of them never draw the same number;
 *   3. route_steps, test_station_type_id and the SAME step_uids are copied (uids are unique within
 *      a route only, so the config moves over as it is);
 *   4. fields_draft = the source's draft, else its latest published config, else NULL;
 *      fields_version = 0, draft_rev = 0 (the new route has published nothing yet);
 *   5. package_contents.route_number of THIS kit's line for the item type moves to the new route —
 *      no other kit's line, and no item_routes row: items already on the way stay on the old route,
 *      and the kit's next intakes take the new one (createPackage reads the line's route_number);
 *   6. the new route is checked against the kit's routes with checkItemRouteAgainstPackage, as
 *      createPackage checks a line's route; a misfit rolls everything back.
 * The source route itself is never changed — its draft, versions and other kits stay as they were.
 *
 * Shape check (step 6): like the template screen (GET …/item-types/[id]/contents), the new route
 * must fit every well-formed route of the kit; a kit with no well-formed route at all cannot take
 * anything in (createPackage refuses it), so neither can its line be forked.
 *
 * SERVER ONLY (prisma). The handler is thin, as admin.ts's are. Error contract — AdminFieldsError,
 * answered as { error: message, code, ...extra }:
 *   400 INVALID_ID (route id) · INVALID_BODY (package_type_id not an int4 id ≥ 1)
 *   400 NOT_A_PACKAGE_TYPE {item_type_id} — package_type_id is not a kit
 *   400 KIT_LINE_NOT_FOUND {package_type_id, item_type_id} — the kit's template has no line for the
 *       route's item type
 *   404 ROUTE_NOT_FOUND {route_id} · ITEM_TYPE_NOT_FOUND {item_type_id} (the kit)
 *   409 LINE_NOT_ON_ROUTE {package_type_id, item_type_id, route_number} — the kit's line runs
 *       another route of the item type than this one (a stale screen, or a second click: the first
 *       fork already moved the line); route_number = the line's
 *   409 ITEM_ROUTE_SHAPE {reason, package_route_number} — the new route does not fit a kit route;
 *       PACKAGE_ROUTE_SHAPE {reason} — the kit has no well-formed route. `reason` is route-rules.ts'
 *       Hebrew text (what the intake would say)
 *   409 ROUTE_NUMBER_TAKEN {route_number} — a route created meanwhile (POST /api/settings/testing-
 *       routes) took the number; asking again draws the next one
 *   500 CONFIG_INVALID / VERSION_MISSING {route_id} — the source config cannot be read; never
 *       copied as "no fields"
 */

/** Any handle that can read: the client or a transaction. */
type Db = TransactionClient;

/** The body as it arrives; checked here (400 when wrong). */
export type ForkInput = { package_type_id?: unknown };

export type ForkResult = ForkResultJson;

/** The same bounds as admin.ts's transactions: the source row may be held by an autosave. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

/** The template screen's word for a kit without a route (GET …/item-types/[id]/contents). */
const KIT_HAS_NO_ROUTE = "לסוג המארז עדיין אין מסלול";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Ids are int4 columns: a larger number can name no row, and Postgres would refuse it as a
 *  parameter (a 500) rather than find nothing. */
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

type SourceRow = {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
  step_uids: string[];
  fields_draft: unknown;
  fields_version: number;
  item_type_desc: string;
};

/** A stored config, parsed — it was stored parsed, so a failure here is corrupt data: a real 500,
 *  never a fork "without fields". */
function parseStored(raw: unknown, routeId: number, what: string): RouteFieldsConfig {
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) {
      throw new AdminFieldsError(500, "CONFIG_INVALID", `Route ${routeId}: the stored ${what} does not parse (${e.message})`, {
        route_id: routeId,
      });
    }
    throw e;
  }
}

/** Step 4: the source's draft, else the config of its latest published version, else null. */
async function configToCopy(db: Db, src: SourceRow): Promise<RouteFieldsConfig | null> {
  const id = src.test_route_id;
  if (src.fields_draft != null) return parseStored(src.fields_draft, id, "draft");
  if (src.fields_version < 1) return null;
  const row = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: id, version: src.fields_version } },
    select: { config: true },
  });
  if (!row) {
    throw new AdminFieldsError(500, "VERSION_MISSING", `Route ${id} points at version ${src.fields_version}, which does not exist`, {
      route_id: id,
    });
  }
  return parseStored(row.config, id, `version ${src.fields_version}`);
}

/**
 * Step 6: the new route against every well-formed route of the kit, as createPackage checks a
 * line's route against the kit route it is taken in on (create-package.ts resolveItemRoute) and
 * the template screen lists a misfit. Throws the 409 that rolls the fork back.
 */
async function checkAgainstKit(db: Db, kitId: number, itemTypeId: number, itemTypeDesc: string, routeNumber: number): Promise<void> {
  const packageLevel = await loadPackageLevelTypeIds(db);
  const kitRoutes = await db.testing_routes.findMany({
    where: { item_type_id: kitId },
    orderBy: { route_number: "asc" },
    select: { route_number: true, route_steps: true },
  });
  const kitShapes: RouteShape[] = kitRoutes.map((r) => ({ itemTypeId: kitId, routeNumber: r.route_number, steps: r.route_steps ?? [] }));
  const wellFormed = kitShapes.filter((s) => checkPackageRoute(s, packageLevel, s.routeNumber) === null);
  if (wellFormed.length === 0) {
    const reason = kitShapes.length === 0 ? KIT_HAS_NO_ROUTE : checkPackageRoute(kitShapes[0], packageLevel, kitShapes[0].routeNumber);
    throw new AdminFieldsError(409, "PACKAGE_ROUTE_SHAPE", `Kit ${kitId} has no well-formed route to check the new route against`, {
      reason,
    });
  }
  const shape = await loadRouteShape(db, itemTypeId, routeNumber);
  for (const kit of wellFormed) {
    const problem = checkItemRouteAgainstPackage(shape, kit, packageLevel, routeNumber);
    if (problem) {
      throw new AdminFieldsError(409, "ITEM_ROUTE_SHAPE", `The new route does not fit route ${kit.routeNumber} of kit ${kitId}`, {
        reason: `${itemTypeDesc}: ${problem}`,
        package_route_number: kit.routeNumber,
      });
    }
  }
}

/** POST /api/settings/testing-routes/[id]/fork (spec §3.2.1) — see the module comment. */
export async function forkRouteForKit(db: PrismaClient, routeId: number, input: ForkInput, actor: Actor): Promise<ForkResult> {
  if (!isId(routeId)) throw new AdminFieldsError(400, "INVALID_ID", "Route id must be a positive integer");
  if (!isRecord(input)) throw new AdminFieldsError(400, "INVALID_BODY", "Body must be {package_type_id}");
  const kitId = input.package_type_id;
  if (!isId(kitId)) throw new AdminFieldsError(400, "INVALID_BODY", "package_type_id must be a kit's item type id");

  return db.$transaction(async (tx) => {
    // 1. The source route, locked.
    const [src] = await tx.$queryRaw<SourceRow[]>`
      SELECT tr.test_route_id, tr.item_type_id, tr.test_station_type_id, tr.route_number,
             COALESCE(tr.route_steps, '{}') AS route_steps,
             COALESCE(tr.step_uids, '{}') AS step_uids,
             tr.fields_draft, tr.fields_version,
             TRIM(t.item_type_desc) AS item_type_desc
        FROM testing_routes tr
        JOIN item_types t ON t.item_type_id = tr.item_type_id
       WHERE tr.test_route_id = ${routeId}
         FOR UPDATE OF tr`;
    if (!src) throw new AdminFieldsError(404, "ROUTE_NOT_FOUND", `Route ${routeId} not found`, { route_id: routeId });

    const [kit] = await tx.$queryRaw<{ is_package: boolean }[]>`
      SELECT is_package FROM item_types WHERE item_type_id = ${kitId}`;
    if (!kit) throw new AdminFieldsError(404, "ITEM_TYPE_NOT_FOUND", `Item type ${kitId} not found`, { item_type_id: kitId });
    if (!kit.is_package) {
      throw new AdminFieldsError(400, "NOT_A_PACKAGE_TYPE", `Item type ${kitId} is not a package type`, { item_type_id: kitId });
    }

    // This kit's line for the item type (package_contents_type_uq: at most one), locked.
    const [line] = await tx.$queryRaw<{ id: number; route_number: number }[]>`
      SELECT id, route_number FROM package_contents
       WHERE package_type_id = ${kitId} AND item_type_id = ${src.item_type_id}
         FOR UPDATE`;
    if (!line) {
      throw new AdminFieldsError(400, "KIT_LINE_NOT_FOUND", `Kit ${kitId} has no template line for item type ${src.item_type_id}`, {
        package_type_id: kitId,
        item_type_id: src.item_type_id,
      });
    }
    if (line.route_number !== src.route_number) {
      throw new AdminFieldsError(409, "LINE_NOT_ON_ROUTE", `Kit ${kitId} runs route ${line.route_number} of item type ${src.item_type_id}, not route ${src.route_number}`, {
        package_type_id: kitId,
        item_type_id: src.item_type_id,
        route_number: line.route_number,
      });
    }

    const config = await configToCopy(tx, src);

    // 2. The next route number of the item type. Two forks of one item type queue here (until the
    //    first commits), so the second reads the first one's number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`testing_routes:new_number:${src.item_type_id}`}, 0))`;
    const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX(route_number), 0)::int + 1 AS next FROM testing_routes WHERE item_type_id = ${src.item_type_id}`;

    // 3–4. The new route.
    let created: { test_route_id: number; route_number: number };
    try {
      created = await tx.testing_routes.create({
        data: {
          item_type_id: src.item_type_id,
          test_station_type_id: src.test_station_type_id,
          route_number: next,
          route_steps: src.route_steps,
          step_uids: src.step_uids,
          draft_rev: 0,
          fields_version: 0,
          // Without a config the column keeps its SQL NULL ("no draft"), never a JSON null.
          ...(config
            ? { fields_draft: config as unknown as Prisma.InputJsonValue, draft_updated_at: new Date(), draft_updated_by: actor.username || null }
            : {}),
        },
        select: { test_route_id: true, route_number: true },
      });
    } catch (e) {
      // testing_routes_type_number_uq: a route POSTed meanwhile took the number.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AdminFieldsError(409, "ROUTE_NUMBER_TAKEN", `Route ${next} of item type ${src.item_type_id} was created meanwhile`, {
          route_number: next,
        });
      }
      throw e;
    }

    // 5. This kit's line only.
    await tx.$executeRaw`UPDATE package_contents SET route_number = ${created.route_number} WHERE id = ${line.id}`;

    // 6. The new route against the kit's shape; a misfit rolls the whole fork back.
    await checkAgainstKit(tx, kitId, src.item_type_id, src.item_type_desc, created.route_number);

    return { test_route_id: created.test_route_id, route_number: created.route_number };
  }, TX_OPTIONS);
}
