import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/lib/db";
import type { Actor } from "@/lib/auth/identity";
import { HttpError } from "@/lib/http/errors";
import { isDbId } from "@/lib/http/request";
import { isRecord } from "@/lib/json-guards";
import { ItemStatus } from "@/lib/item-status";
import { loadPackageLevelTypeIds } from "@/app/lib/packages/route-rules";
import { APPLY_MODES, STEP_UNKNOWN, VERSION_NOTE_MAX } from "./admin-types";
import type {
  ApplyMode, DraftSavedJson, FieldVersionRowJson, FieldVersionSummaryJson, PublishImpactJson, PublishResultJson,
  RouteFieldsJson, RouteIssueJson, SharedKitJson,
} from "./admin-types";
import { diffConfigs } from "./diff";
import type { Change } from "./diff";
import { KIT_ROUTE_LABEL, routeOfTypeLabel } from "./labels";
import { syncFieldPhotoGroups } from "./photo-groups";
import {
  STATION_FIELDS_READ_TX, STATION_FIELDS_TX, loadRoute, readDraft, readPublished, writeDraft,
} from "./route-store";
import type { RouteRow } from "./route-store";
import { stepConfigOf, stepIndexOf } from "./schema";
import type { RouteFieldsConfig, StepUid } from "./schema";
import { checkConfigAgainstRoute, lintRouteFieldsConfig, parseRouteFieldsConfig, shapeOr400, unknownStepIssues } from "./validate";
import type { Issue } from "./validate";

/**
 * Station fields — the admin side of the API (route-fields spec §3.2, §3.4.1–§3.4.3): read a
 * route's field config, autosave / discard its draft, preview and publish drafts, read the
 * published versions.
 *
 * SERVER ONLY (prisma). The handlers under /api/settings/testing-routes/ are thin: they read the
 * path and the body, resolve the actor and answer a thrown HttpError as JSON.
 * Every rule lives here, as functions over a Prisma client and plain inputs, so tests call them
 * directly; they answer the wire shapes of admin-types.ts.
 *
 * Error contract — HttpError(status, message, { code, extra }), answered as
 * { error: message, code, ...extra }:
 *   400 INVALID_ID (not an int4 id ≥ 1) · INVALID_BODY · SHAPE_INVALID {path} · NOTE_TOO_LONG
 *   404 ROUTE_NOT_FOUND {route_id} · VERSION_NOT_FOUND {route_id, version}
 *   409 DRAFT_CONFLICT — draft endpoints {draft, draft_rev, draft_updated_at, draft_updated_by},
 *       publish {conflicts: [{route_id, draft_rev}]}
 *   409 STEP_UNKNOWN {route_id, uids} — PUT draft only: the config names a step uid the route
 *       does not have. Publish and its preview list such a uid as a STEP_UNKNOWN error issue (422).
 *   422 LINT_ERRORS {issues} — every issue of every draft, each with its route_id
 *   500 CONFIG_INVALID / VERSION_MISSING — a stored config that does not parse, or a
 *       fields_version without its row: never answered as "no fields"
 *
 * Locks: a draft write locks its testing_routes row; publish locks every route of the batch in
 * ascending id order (the one order any multi-route write may take) before reading anything.
 *
 * Which unfinished item_routes rows a publish moves to the new version ("על מי תחול גרסה N",
 * APPLY_MODES); items taken in from now on always freeze the new one:
 *   new_only     none — only new intakes (the dialog no longer offers it; scripts and tests do)
 *   not_started  rows that have not started their route: queued at step 1 — a kit taken in but
 *                not opened yet, its items, an item waiting at its first station (the default)
 *   not_reached  those, and every row queued or waiting at or before the first changed step
 *   all          every unfinished row, in test and in research too. A popup open on a moved row
 *                is refused on save (409 FIELDS_SCHEMA_MISMATCH) and reloads with the new fields,
 *                keeping what the worker typed.
 * Every mode moves rows taken in before station fields (fields_version NULL) as well (decided
 * 2026-10-14, replacing spec §8.1's "a NULL row keeps the fixed popups"). See movableRows.
 */

/** Any handle that can read: the client or a transaction. */
type Db = TransactionClient;

/** More routes than any kit context holds — a guard on the size of one transaction. */
const MAX_ROUTES = 100;

// ---- request helpers ----------------------------------------------------------------------------
const isRev = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function badBody(message: string): HttpError {
  return new HttpError(400, message, { code: "INVALID_BODY" });
}

/** A path id (parseDbId: null when it cannot name a row) or a body id. */
function requireId(v: number | null, what: string): number {
  if (!isDbId(v)) throw new HttpError(400, `${what} must be a positive integer`, { code: "INVALID_ID" });
  return v;
}

function notFound(routeId: number): HttpError {
  return new HttpError(404, `Route ${routeId} not found`, { code: "ROUTE_NOT_FOUND", extra: { route_id: routeId } });
}

function stepUnknown(routeId: number, uids: StepUid[]): HttpError {
  return new HttpError(409, `The config names steps route ${routeId} does not have`, { code: STEP_UNKNOWN, extra: {
    route_id: routeId,
    uids,
  } });
}

function revOf(raw: unknown): number {
  if (!isRev(raw)) throw badBody("base_rev must be a non-negative integer");
  return raw;
}

/** route_ids: a non-empty list of ids, deduplicated and ascending (the lock order). */
function routeIdsOf(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isDbId)) {
    throw badBody("route_ids must be a non-empty array of route ids");
  }
  const ids = [...new Set(raw)].sort((a, b) => a - b);
  if (ids.length > MAX_ROUTES) throw badBody(`route_ids may name at most ${MAX_ROUTES} routes`);
  return ids;
}

// ---- loading ------------------------------------------------------------------------------------
/** The routes of a batch, one by one in ascending id order — with `lock`, that is the lock order.
 *  A missing route is a 404 for the whole request. */
async function loadRoutes(db: Db, ascendingIds: readonly number[], lock: boolean): Promise<RouteRow[]> {
  const out: RouteRow[] = [];
  for (const id of ascendingIds) {
    const route = await loadRoute(db, id, { lock });
    if (!route) throw notFound(id);
    out.push(route);
  }
  return out;
}

/** Kits whose template runs this item route (package_contents.route_number), optionally leaving
 *  out the kit the screen is open on (spec §3.4.2). */
async function kitsUsingRoute(db: Db, itemTypeId: number, routeNumber: number, exceptKit: number | null): Promise<SharedKitJson[]> {
  const rows = await db.$queryRaw<{ package_type_id: number; kit_desc: string }[]>`
    SELECT pc.package_type_id, TRIM(t.item_type_desc) AS kit_desc
      FROM package_contents pc
      JOIN item_types t ON t.item_type_id = pc.package_type_id
     WHERE pc.item_type_id = ${itemTypeId}
       AND pc.route_number = ${routeNumber}
       AND (${exceptKit}::int IS NULL OR pc.package_type_id <> ${exceptKit}::int)
     ORDER BY pc.package_type_id`;
  return rows.map((r) => ({ package_type_id: r.package_type_id, desc: r.kit_desc }));
}

/** Lint (spec §2.3) and the check against the live route, as one list — a step uid the route does
 *  not have included (STEP_UNKNOWN), so the editor lists every error publish would refuse. */
function configIssues(cfg: RouteFieldsConfig, route: RouteRow, packageLevel: ReadonlySet<number>): Issue[] {
  const check = checkConfigAgainstRoute(cfg, route.route_steps, route.step_uids, packageLevel);
  return [...lintRouteFieldsConfig(cfg), ...check.issues, ...unknownStepIssues(check.unknownUids)];
}

// ---- publish analysis (shared by preview and publish, so both see the same thing) -----------------
type Prepared = { route: RouteRow; draft: RouteFieldsConfig; published: RouteFieldsConfig | null };

/**
 * The drafts of a batch, checked as publish requires (spec §3.4.3 step 3): routes without a draft
 * are skipped (nothing to publish); any lint or route-check error of any route — a step uid the
 * route does not have among them — is a 422 for the whole batch. Warnings come back with the drafts.
 */
async function prepareDrafts(db: Db, routes: readonly RouteRow[]): Promise<{ prepared: Prepared[]; issues: RouteIssueJson[] }> {
  const packageLevel = await loadPackageLevelTypeIds(db);
  const prepared: Prepared[] = [];
  const issues: RouteIssueJson[] = [];
  for (const route of routes) {
    if (route.fields_draft == null) continue;
    const id = route.test_route_id;
    const draft = readDraft(route)!;
    const published = readPublished(route);
    for (const issue of configIssues(draft, route, packageLevel)) issues.push({ route_id: id, ...issue });
    prepared.push({ route, draft, published });
  }
  if (issues.some((i) => i.level === "error")) {
    throw new HttpError(422, "The drafts have errors that block publishing", { code: "LINT_ERRORS", extra: { issues } });
  }
  return { prepared, issues };
}

/**
 * "מולא ב-N בדיקות" for a removed field (spec §3.4.2): saved results of this route that hold a
 * value for it — in details.fields, or in a close-wizard decision (details.decisions[i].fields on
 * the box row, "נארז בכל זאת"; only a box row's decisions carry fields, submit.ts strips them from
 * every other row). Field ids are unique within a step, not within a route (a field set applied to
 * several cells keeps its ids), so the step is matched too.
 */
async function filledCount(db: Db, routeId: number, stepUid: StepUid, fieldId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM test_results
     WHERE (details -> 'schema' ->> 'route_id') = ${String(routeId)}
       AND (details -> 'schema' ->> 'step_uid') = ${stepUid}
       AND ( (details -> 'fields') ? ${fieldId}
          OR ( (details -> 'schema' ->> 'target') = 'box'
               AND EXISTS (SELECT 1
                             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(details -> 'decisions') = 'array'
                                                            THEN details -> 'decisions' ELSE '[]'::jsonb END) d
                            WHERE (d -> 'fields') ? ${fieldId}) ) )`;
  return rows[0]?.n ?? 0;
}

/** What changed from the published version to the draft, with the fill count on every removed field. */
async function changesOf(db: Db, p: Prepared): Promise<Change[]> {
  const id = p.route.test_route_id;
  const out: Change[] = [];
  for (const c of diffConfigs(p.published, p.draft, id)) {
    out.push(c.kind === "field_removed" && c.field_id ? { ...c, filled_count: await filledCount(db, id, c.step_uid, c.field_id) } : c);
  }
  return out;
}

/**
 * $min_changed_pos of spec §3.4.3 step 6: the 1-based position, in the route's CURRENT order, of
 * the first changed step uid. A step that left the route has no position, so its step_removed row
 * is skipped; a step still on the route counts whatever the row's kind (a draft that dropped the
 * step's whole config changes that station too). null when no changed step is on the route —
 * nothing to move.
 */
function firstChangedPosition(changes: readonly Change[], route: RouteRow): number | null {
  let first: number | null = null;
  for (const c of changes) {
    const i = stepIndexOf(route, c.step_uid);
    if (i >= 0 && (first === null || i + 1 < first)) first = i + 1;
  }
  return first;
}

/**
 * The item_routes rows a publish of `route` moves to the new version under `mode` (APPLY_MODES;
 * spec §3.4.3 step 6) — whatever version they froze, NULL included. One predicate for the UPDATE
 * and the preview count, so the dialog's number is what publish moves. null: nothing moves.
 *   not_started  unfinished, queued (ממתין) at step 1: nothing of the route has started.
 *   not_reached  unfinished, queued or waiting for the kit's items (ממתין לפריטי המארז) at or
 *                before the first changed step — never in test or in research. The first changed step is ≥ 1, so
 *                not_started's rows are always among them; with no changed step on the route
 *                (minChangedPos null) it is not_started alone.
 *   all          unfinished, any status and step.
 */
function movableRows(route: RouteRow, mode: ApplyMode, minChangedPos: number | null): Prisma.Sql | null {
  const ofRoute = Prisma.sql`ir.item_type_id = ${route.item_type_id}
     AND ir.route_number = ${route.route_number}
     AND ir.finished_at IS NULL`;
  const notStarted = Prisma.sql`${ofRoute}
     AND ir.current_status = ${ItemStatus.Queued}
     AND ir.current_route_step = 1`;
  switch (mode) {
    case "new_only":
      return null;
    case "not_started":
      return notStarted;
    case "not_reached":
      if (minChangedPos === null) return notStarted;
      return Prisma.sql`${ofRoute}
     AND ir.current_status IN (${ItemStatus.Queued}, ${ItemStatus.AwaitPackageItems})
     AND ir.current_route_step <= ${minChangedPos}`;
    case "all":
      return ofRoute;
  }
}

/** How many rows movableRows names (0 when it names none). */
async function countMovable(db: Db, where: Prisma.Sql | null): Promise<number> {
  if (where === null) return 0;
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM item_routes ir WHERE ${where}`;
  return rows[0]?.n ?? 0;
}

/**
 * The stations behind artboard 10's "{n} עמדות", as station type ids: a station is a station type
 * (a column of the fields map, named like the dialog's groups "{station} · {item}"), so one type
 * changed on several item routes counts once. Rows of kind layout_changed are not a station's
 * fields (the artboard's 6 changes span 4 groups, and its "פריסת החלון" group is not one of the
 * "3 עמדות"). A step's type is the live route_steps at its position; a step that left the route
 * keeps the type recorded in the published version.
 */
function stationTypesTouched(p: Prepared, changes: readonly Change[]): number[] {
  const out: number[] = [];
  for (const c of changes) {
    if (c.kind === "layout_changed") continue;
    const i = stepIndexOf(p.route, c.step_uid);
    const typeId = i >= 0 ? p.route.route_steps[i] : (p.published && stepConfigOf(p.published, c.step_uid)?.station_type_id);
    if (typeof typeId === "number") out.push(typeId);
  }
  return out;
}

/** Unfinished rows of the route, by the version they froze. */
async function itemsByVersion(db: Db, route: RouteRow): Promise<{ version: number | null; count: number }[]> {
  return db.$queryRaw<{ version: number | null; count: number }[]>`
    SELECT fields_version AS version, count(*)::int AS count
      FROM item_routes
     WHERE item_type_id = ${route.item_type_id}
       AND route_number = ${route.route_number}
       AND finished_at IS NULL
     GROUP BY fields_version
     ORDER BY fields_version NULLS FIRST`;
}

// ---- endpoints ------------------------------------------------------------------------------------
/** GET …/[id]/fields (spec §3.2). */
export async function getRouteFields(db: Db, rawRouteId: number | null): Promise<RouteFieldsJson> {
  const routeId = requireId(rawRouteId, "Route id");
  const route = await loadRoute(db, routeId);
  if (!route) throw notFound(routeId);
  const draft = readDraft(route);
  const published = readPublished(route);
  const shown = draft ?? published;
  return {
    route: {
      test_route_id: route.test_route_id,
      item_type_id: route.item_type_id,
      route_number: route.route_number,
      route_steps: route.route_steps,
      step_uids: route.step_uids,
    },
    draft,
    draft_rev: route.draft_rev,
    draft_updated_at: route.draft_updated_at?.toISOString() ?? null,
    draft_updated_by: route.draft_updated_by,
    published_version: route.fields_version,
    published,
    issues: shown ? configIssues(shown, route, await loadPackageLevelTypeIds(db)) : [],
    shared_with: await kitsUsingRoute(db, route.item_type_id, route.route_number, null),
  };
}

/** The 409 of a draft write whose base_rev is stale: the current draft, so the editor can reload. */
function draftConflict(route: RouteRow): HttpError {
  return new HttpError(409, "The draft changed since base_rev", { code: "DRAFT_CONFLICT", extra: {
    draft: route.fields_draft ?? null,
    draft_rev: route.draft_rev,
    draft_updated_at: route.draft_updated_at?.toISOString() ?? null,
    draft_updated_by: route.draft_updated_by,
  } });
}

/**
 * PUT …/[id]/fields/draft — autosave (spec §3.4.1). Stores the SANITIZED config and bumps
 * draft_rev. Lint errors never block a draft save; they come back as `issues`.
 */
export async function saveFieldsDraft(db: PrismaClient, rawRouteId: number | null, input: unknown, actor: Actor): Promise<DraftSavedJson> {
  const routeId = requireId(rawRouteId, "Route id");
  if (!isRecord(input)) throw badBody("Body must be {config, base_rev}");
  const baseRev = revOf(input.base_rev);
  // Structure only (spec §2.3) — the sanitized copy is what gets stored.
  const config = shapeOr400(() => parseRouteFieldsConfig(input.config));
  return db.$transaction(async (tx) => {
    const route = await loadRoute(tx, routeId, { lock: true });
    if (!route) throw notFound(routeId);
    if (route.draft_rev !== baseRev) throw draftConflict(route);
    const packageLevel = await loadPackageLevelTypeIds(tx);
    const check = checkConfigAgainstRoute(config, route.route_steps, route.step_uids, packageLevel);
    if (check.unknownUids.length > 0) throw stepUnknown(routeId, check.unknownUids);
    const saved = await writeDraft(tx, routeId, config, actor);
    return {
      draft_rev: saved.draft_rev,
      draft_updated_at: saved.draft_updated_at.toISOString(),
      issues: [...lintRouteFieldsConfig(config), ...check.issues],
    };
  }, STATION_FIELDS_TX);
}

/** DELETE …/[id]/fields/draft — "ביטול הטיוטה" (spec §3.4.1): back to the published config. */
export async function discardFieldsDraft(db: PrismaClient, rawRouteId: number | null, input: unknown, actor: Actor): Promise<{ draft_rev: number }> {
  const routeId = requireId(rawRouteId, "Route id");
  if (!isRecord(input)) throw badBody("Body must be {base_rev}");
  const baseRev = revOf(input.base_rev);
  return db.$transaction(async (tx) => {
    const route = await loadRoute(tx, routeId, { lock: true });
    if (!route) throw notFound(routeId);
    if (route.draft_rev !== baseRev) throw draftConflict(route);
    const { draft_rev } = await writeDraft(tx, routeId, null, actor);
    return { draft_rev };
  }, STATION_FIELDS_TX);
}

/**
 * POST …/fields/publish-preview (spec §3.4.2) — what publishing these routes would do. Read-only,
 * in one REPEATABLE READ snapshot so the counts agree with the drafts they were computed from.
 * context_kit_id: the kit the screen is open on — its route is "מסלול המארז", and it is not
 * "outside" in shared_outside.
 */
export async function previewPublish(db: PrismaClient, input: unknown): Promise<PublishImpactJson> {
  if (!isRecord(input)) throw badBody("Body must be {route_ids, context_kit_id?}");
  const routeIds = routeIdsOf(input.route_ids);
  const rawKit = input.context_kit_id ?? null;
  if (rawKit !== null && !isDbId(rawKit)) throw badBody("context_kit_id must be an item type id");
  const contextKit: number | null = rawKit;
  return db.$transaction(async (tx) => {
    const routes = await loadRoutes(tx, routeIds, false);
    const { prepared, issues } = await prepareDrafts(tx, routes);
    const impact: PublishImpactJson = {
      routes: [],
      totals: { changes: 0, stations: 0, routes: 0 },
      shared_outside: [],
      items_on_routes: 0,
      by_version: [],
      not_started: 0,
      not_reached: 0,
      issues,
      base_revs: Object.fromEntries(routes.map((r) => [r.test_route_id, r.draft_rev])),
    };
    const stations = new Set<number>();
    for (const p of prepared) {
      const { route } = p;
      const id = route.test_route_id;
      const changes = await changesOf(tx, p);
      impact.routes.push({
        route_id: id,
        label: contextKit !== null && route.item_type_id === contextKit
          ? KIT_ROUTE_LABEL
          : routeOfTypeLabel(route.route_number, route.item_type_desc),
        item_type_id: route.item_type_id,
        item_type_desc: route.item_type_desc,
        route_number: route.route_number,
        from_version: route.fields_version,
        to_version: route.fields_version + 1,
        changes,
      });
      impact.totals.changes += changes.length;
      for (const typeId of stationTypesTouched(p, changes)) stations.add(typeId);
      const kits = await kitsUsingRoute(tx, route.item_type_id, route.route_number, contextKit);
      if (kits.length > 0) {
        impact.shared_outside.push({ route_id: id, item_type_desc: route.item_type_desc, route_number: route.route_number, kits });
      }
      for (const row of await itemsByVersion(tx, route)) {
        impact.by_version.push({ route_id: id, version: row.version, count: row.count });
        impact.items_on_routes += row.count;
      }
      const pos = firstChangedPosition(changes, route);
      impact.not_started += await countMovable(tx, movableRows(route, "not_started", pos));
      impact.not_reached += await countMovable(tx, movableRows(route, "not_reached", pos));
    }
    impact.totals.stations = stations.size;
    impact.totals.routes = impact.routes.length;
    return impact;
  }, STATION_FIELDS_READ_TX);
}

/**
 * POST …/fields/publish (spec §3.4.3) — one transaction for the whole batch. Every route is locked
 * (ascending ids) and its draft_rev checked against base_revs before anything is read; each route
 * with a draft becomes version fields_version + 1, all under one publish_batch, and its draft is
 * cleared. Every mode but "new_only" also moves the rows of movableRows to the new version.
 *
 * Each route's photo fields get their photo groups (photo-groups.ts) with its version.
 *
 * Every read comes first — the "מולא ב-N בדיקות" counts scan test_results — and the item_routes
 * rows are moved last: a worker's start-test or results submit on such a row waits for its lock,
 * so the lock is taken only once nothing slow is left before the commit.
 */
export async function publishFields(db: PrismaClient, input: unknown, actor: Actor): Promise<PublishResultJson> {
  if (!isRecord(input)) throw badBody("Body must be {route_ids, base_revs, apply_mode, note?}");
  const routeIds = routeIdsOf(input.route_ids);
  const rawRevs = input.base_revs;
  if (!isRecord(rawRevs)) throw badBody("base_revs must map every route id to its draft_rev");
  const baseRevs = new Map<number, number>();
  for (const id of routeIds) {
    const rev = Object.prototype.hasOwnProperty.call(rawRevs, String(id)) ? rawRevs[String(id)] : undefined;
    if (!isRev(rev)) throw badBody(`base_revs must give route ${id} a non-negative integer draft_rev`);
    baseRevs.set(id, rev);
  }
  const rawMode = input.apply_mode;
  if (!(APPLY_MODES as readonly unknown[]).includes(rawMode)) throw badBody(`apply_mode must be one of ${APPLY_MODES.join(", ")}`);
  const applyMode = rawMode as ApplyMode;
  const rawNote = input.note ?? null;
  if (rawNote !== null && typeof rawNote !== "string") throw badBody("note must be a string");
  if (rawNote !== null && rawNote.length > VERSION_NOTE_MAX) {
    throw new HttpError(400, `note is longer than ${VERSION_NOTE_MAX} characters`, { code: "NOTE_TOO_LONG", extra: { max: VERSION_NOTE_MAX } });
  }
  const note = rawNote?.trim() || null;

  return db.$transaction(async (tx) => {
    const routes = await loadRoutes(tx, routeIds, true);
    const conflicts = routes
      .filter((r) => r.draft_rev !== baseRevs.get(r.test_route_id))
      .map((r) => ({ route_id: r.test_route_id, draft_rev: r.draft_rev }));
    if (conflicts.length > 0) {
      throw new HttpError(409, "A draft changed since base_revs", { code: "DRAFT_CONFLICT", extra: { conflicts } });
    }
    const { prepared } = await prepareDrafts(tx, routes);
    // Reads: what changed on each route, with its fill counts.
    const planned: { p: Prepared; v: number; changes: Change[] }[] = [];
    for (const p of prepared) planned.push({ p, v: p.route.fields_version + 1, changes: await changesOf(tx, p) });

    const publishBatch = randomUUID();
    const versions: Record<number, number> = {};
    for (const { p, v, changes } of planned) {
      const id = p.route.test_route_id;
      await tx.$executeRaw`
        INSERT INTO route_field_versions
               (test_route_id, version, config, changes, note, apply_mode, publish_batch, published_by, published_by_name)
        VALUES (${id}, ${v}, ${JSON.stringify(p.draft)}::jsonb, ${JSON.stringify(changes)}::jsonb, ${note},
                ${applyMode}, ${publishBatch}::uuid, ${actor.username}, ${actor.name || null})`;
      await tx.$executeRaw`
        UPDATE testing_routes
           SET fields_version = ${v}, fields_draft = NULL, draft_rev = draft_rev + 1
         WHERE test_route_id = ${id}`;
      // The photo fields' own groups, named after the field as published.
      await syncFieldPhotoGroups(tx, id, p.draft);
      versions[id] = v;
    }

    // Last: the rows the chosen mode moves.
    let bumped = 0;
    for (const { p, v, changes } of planned) {
      const where = movableRows(p.route, applyMode, firstChangedPosition(changes, p.route));
      if (where !== null) bumped += await tx.$executeRaw`UPDATE item_routes ir SET fields_version = ${v} WHERE ${where}`;
    }
    return { publish_batch: publishBatch, versions, bumped_items: bumped };
  }, STATION_FIELDS_TX);
}

/** GET …/[id]/fields/versions — "היסטוריית גרסאות", newest first. */
export async function listFieldVersions(db: Db, rawRouteId: number | null): Promise<FieldVersionSummaryJson[]> {
  const routeId = requireId(rawRouteId, "Route id");
  const route = await db.testing_routes.findUnique({ where: { test_route_id: routeId }, select: { test_route_id: true } });
  if (!route) throw notFound(routeId);
  const rows = await db.route_field_versions.findMany({
    where: { test_route_id: routeId },
    orderBy: { version: "desc" },
    select: { version: true, published_at: true, published_by_name: true, note: true, apply_mode: true, publish_batch: true, changes: true },
  });
  return rows.map((r) => ({ ...r, published_at: r.published_at.toISOString(), changes: r.changes as unknown as Change[] | null }));
}

/** GET …/[id]/fields/versions/[v] — one published version, whole (as stored at publish). */
export async function getFieldVersion(db: Db, rawRouteId: number | null, rawVersion: number | null): Promise<FieldVersionRowJson> {
  const routeId = requireId(rawRouteId, "Route id");
  const version = requireId(rawVersion, "Version");
  const row = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: routeId, version } },
  });
  if (!row) {
    throw new HttpError(404, `Route ${routeId} has no version ${version}`, { code: "VERSION_NOT_FOUND", extra: { route_id: routeId, version } });
  }
  return {
    id: row.id,
    test_route_id: row.test_route_id,
    version: row.version,
    config: row.config as unknown as RouteFieldsConfig,
    changes: row.changes as unknown as Change[] | null,
    note: row.note,
    apply_mode: row.apply_mode,
    publish_batch: row.publish_batch,
    published_at: row.published_at.toISOString(),
    published_by: row.published_by,
    published_by_name: row.published_by_name,
  };
}
