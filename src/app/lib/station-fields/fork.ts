import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import { checkPackageRoute, loadPackageLevelTypeIds, loadRouteShape } from "@/app/lib/packages/route-rules";
import type { RouteShape } from "@/app/lib/packages/route-rules";
import { kitRouteFit } from "@/app/lib/packages/template";
import { KIT_HAS_NO_ROUTE } from "@/app/lib/packages/template-wire";
import type { Actor } from "@/lib/auth/identity";
import { HttpError } from "@/lib/http/errors";
import { isDbId } from "@/lib/http/request";
import { isRecord } from "@/lib/json-guards";
import type { ForkResultJson } from "./admin-types";
import { STATION_FIELDS_TX, loadRoute, readDraft, readPublished } from "./route-store";

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
 * SERVER ONLY (prisma). The handler is thin, as admin.ts's are. Error contract — HttpError
 * (route-store.ts), answered as { error: message, code, ...extra }:
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

/**
 * Step 6: the new route against every well-formed route of the kit (template.ts kitRouteFit, the
 * template screen's rule; the intake checks a line's route against the kit route it is taken in on,
 * lifecycle.ts resolveItemRoute). Throws the 409 that rolls the fork back.
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
    throw new HttpError(409, `Kit ${kitId} has no well-formed route to check the new route against`, { code: "PACKAGE_ROUTE_SHAPE", extra: {
      reason,
    } });
  }
  const misfit = kitRouteFit(wellFormed, await loadRouteShape(db, itemTypeId, routeNumber), packageLevel, routeNumber);
  if (misfit) {
    throw new HttpError(409, `The new route does not fit route ${misfit.kit.routeNumber} of kit ${kitId}`, { code: "ITEM_ROUTE_SHAPE", extra: {
      reason: `${itemTypeDesc}: ${misfit.problem}`,
      package_route_number: misfit.kit.routeNumber,
    } });
  }
}

/** POST /api/settings/testing-routes/[id]/fork (spec §3.2.1) — see the module comment. */
export async function forkRouteForKit(db: PrismaClient, routeId: number | null, input: unknown, actor: Actor): Promise<ForkResultJson> {
  if (!isDbId(routeId)) throw new HttpError(400, "Route id must be a positive integer", { code: "INVALID_ID" });
  if (!isRecord(input)) throw new HttpError(400, "Body must be {package_type_id}", { code: "INVALID_BODY" });
  const kitId = input.package_type_id;
  if (!isDbId(kitId)) throw new HttpError(400, "package_type_id must be a kit's item type id", { code: "INVALID_BODY" });

  return db.$transaction(async (tx) => {
    const src = await loadRoute(tx, routeId, { lock: true });
    if (!src) throw new HttpError(404, `Route ${routeId} not found`, { code: "ROUTE_NOT_FOUND", extra: { route_id: routeId } });

    const [kit] = await tx.$queryRaw<{ is_package: boolean }[]>`
      SELECT is_package FROM item_types WHERE item_type_id = ${kitId}`;
    if (!kit) throw new HttpError(404, `Item type ${kitId} not found`, { code: "ITEM_TYPE_NOT_FOUND", extra: { item_type_id: kitId } });
    if (!kit.is_package) {
      throw new HttpError(400, `Item type ${kitId} is not a package type`, { code: "NOT_A_PACKAGE_TYPE", extra: { item_type_id: kitId } });
    }

    // This kit's line for the item type (package_contents_type_uq: at most one), locked.
    const [line] = await tx.$queryRaw<{ id: number; route_number: number }[]>`
      SELECT id, route_number FROM package_contents
       WHERE package_type_id = ${kitId} AND item_type_id = ${src.item_type_id}
         FOR UPDATE`;
    if (!line) {
      throw new HttpError(400, `Kit ${kitId} has no template line for item type ${src.item_type_id}`, { code: "KIT_LINE_NOT_FOUND", extra: {
        package_type_id: kitId,
        item_type_id: src.item_type_id,
      } });
    }
    if (line.route_number !== src.route_number) {
      throw new HttpError(409, `Kit ${kitId} runs route ${line.route_number} of item type ${src.item_type_id}, not route ${src.route_number}`, { code: "LINE_NOT_ON_ROUTE", extra: {
        package_type_id: kitId,
        item_type_id: src.item_type_id,
        route_number: line.route_number,
      } });
    }

    const config = readDraft(src) ?? readPublished(src);

    // 2. The next route number of the item type. Two forks of one item type queue here (until the
    //    first commits), so the second reads the first one's number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`testing_routes:new_number:${src.item_type_id}`}, 0))`;
    const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX(route_number), 0)::int + 1 AS next FROM testing_routes WHERE item_type_id = ${src.item_type_id}`;

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
            ? { fields_draft: config as unknown as Prisma.InputJsonValue, draft_updated_at: new Date(), draft_updated_by: actor.username }
            : {}),
        },
        select: { test_route_id: true, route_number: true },
      });
    } catch (e) {
      // testing_routes_type_number_uq: a route POSTed meanwhile took the number.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new HttpError(409, `Route ${next} of item type ${src.item_type_id} was created meanwhile`, { code: "ROUTE_NUMBER_TAKEN", extra: {
          route_number: next,
        } });
      }
      throw e;
    }

    await tx.$executeRaw`UPDATE package_contents SET route_number = ${created.route_number} WHERE id = ${line.id}`;

    // 6. The new route against the kit's shape; a misfit rolls the whole fork back.
    await checkAgainstKit(tx, kitId, src.item_type_id, src.item_type_desc, created.route_number);

    return { test_route_id: created.test_route_id, route_number: created.route_number };
  }, STATION_FIELDS_TX);
}
