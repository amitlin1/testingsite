import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import type { TransactionClient } from "@/app/lib/prisma";
import { loadPackageLevelTypeIds } from "@/app/lib/packages/route-rules";
import { STATUS_QUEUED, STATUS_WAITING_FOR_PACKAGE_ITEMS } from "@/app/lib/packages/readiness";
import { diffConfigs } from "./diff";
import type { Change } from "./diff";
import { KIT_ROUTE_LABEL, routeOfTypeLabel } from "./labels";
import { stepConfigOf } from "./schema";
import type { RouteFieldsConfig, StepUid } from "./schema";
import { ShapeError, checkConfigAgainstRoute, lintRouteFieldsConfig, parseRouteFieldsConfig, unknownStepIssues } from "./validate";
import type { Issue } from "./validate";

/**
 * Station fields — the admin side of the API (route-fields spec §3.2, §3.4.1–§3.4.3): read a
 * route's field config, autosave / discard its draft, preview and publish drafts, read the
 * published versions.
 *
 * SERVER ONLY (prisma). The handlers under /api/settings/testing-routes/ are thin: they read the
 * path and the body, resolve the actor and turn an AdminFieldsError into JSON. Every rule lives
 * here, as functions over a Prisma client and plain inputs, so tests call them directly.
 *
 * Error contract — AdminFieldsError(status, code, message, extra), answered as
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
 */

// ---- types ----------------------------------------------------------------------------------
/** Any handle that can read: the client or a transaction. */
type Db = TransactionClient;

/** Who writes. username = session preferredUsername (draft_updated_by, published_by); name = the
 *  display-name snapshot kept with a version (published_by_name). */
export type Actor = { username: string; name: string | null };

/** A kit whose template (package_contents) runs an item type on this route. */
export type SharedKit = { package_type_id: number; desc: string };

/** A lint / route-check issue of one route in a multi-route preview or publish. */
export type RouteIssue = Issue & { route_id: number };

export type RouteFieldsView = {
  route: { test_route_id: number; item_type_id: number; route_number: number; route_steps: number[]; step_uids: string[] };
  /** Pending changes; null = none (the editor starts from `published`). */
  draft: RouteFieldsConfig | null;
  draft_rev: number;
  draft_updated_at: Date | null;
  draft_updated_by: string | null;
  /** testing_routes.fields_version: 0 = never published. */
  published_version: number;
  /** The config of `published_version`; null when never published. */
  published: RouteFieldsConfig | null;
  /** Lint + route check of the config the editor shows (draft ?? published). */
  issues: Issue[];
  /** Kits whose template line runs this route (item_type_id, route_number) — "משותף ל: …". */
  shared_with: SharedKit[];
};

/** Bodies as they arrive; every member is checked here (400 when wrong). */
export type DraftPutInput = { config?: unknown; base_rev?: unknown };
export type DraftDeleteInput = { base_rev?: unknown };
export type PublishPreviewInput = { route_ids?: unknown; context_kit_id?: unknown };
export type PublishInput = { route_ids?: unknown; base_revs?: unknown; apply_mode?: unknown; note?: unknown };

export type DraftSaved = { draft_rev: number; draft_updated_at: Date; issues: Issue[] };

export const APPLY_MODES = ["new_only", "not_reached"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

/** "הערת גרסה" (artboard 10): at most 2000 characters (spec §3.2). */
export const VERSION_NOTE_MAX = 2000;

/** More routes than any kit context holds — a guard on the size of one transaction. */
const MAX_ROUTES = 100;

/** Publish and preview count filled results per removed field (a scan of test_results) while the
 *  routes are locked; a draft save may wait on such a publish rather than fail. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

/** One route of a publish (artboard 10, "מה השתנה"). */
export type PublishImpactRoute = {
  route_id: number;
  /** "מסלול 1 של מחשב" / "מסלול המארז". */
  label: string;
  item_type_id: number;
  item_type_desc: string;
  route_number: number;
  from_version: number;
  to_version: number;
  /** diffConfigs(published, draft); every field_removed row carries filled_count. */
  changes: Change[];
};

/** publish-preview (spec §3.4.2). Covers the requested routes that have a draft — the ones a
 *  publish of the same request would version. */
export type PublishImpact = {
  routes: PublishImpactRoute[];
  /** "6 שינויים" · "3 עמדות" · "3 מסלולים" — see stationTypesTouched for what a station is. */
  totals: { changes: number; stations: number; routes: number };
  /** Routes that other kits (not context_kit_id) also run — the warning note of artboard 10. */
  shared_outside: { route_id: number; item_type_desc: string; route_number: number; kits: SharedKit[] }[];
  /** "9 פריטים נמצאים כעת במסלולים האלה": unfinished item_routes rows on these routes. */
  items_on_routes: number;
  /** The same rows by the version they froze (null = before station fields). */
  by_version: { route_id: number; version: number | null; count: number }[];
  /** Exactly the rows apply_mode "not_reached" would move ("· 4 פריטים"). */
  not_reached: number;
  /** Warnings (errors answer 422 instead). */
  issues: RouteIssue[];
  /** draft_rev of every requested route: the base_revs that publish exactly what was previewed. */
  base_revs: Record<number, number>;
};

export type PublishResult = { publish_batch: string; versions: Record<number, number>; bumped_items: number };

/** One row of "היסטוריית גרסאות", newest first. */
export type FieldVersionSummary = {
  version: number;
  published_at: Date;
  published_by_name: string | null;
  note: string | null;
  apply_mode: string;
  publish_batch: string;
  changes: Change[] | null;
};

/** A whole route_field_versions row (spec §3.4.4: open an old result's config by schema.v). */
export type FieldVersionRow = FieldVersionSummary & {
  id: number;
  test_route_id: number;
  config: RouteFieldsConfig;
  published_by: string | null;
};

// ---- errors and request helpers ----------------------------------------------------------------
/** A refusal the admin API explains to its caller: `status` and a stable `code` for the client,
 *  an English `message` (developer-facing; the screen words its own states), `extra` merged into
 *  the JSON body. */
export class AdminFieldsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "AdminFieldsError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Shared tail of the handlers: AdminFieldsError → its status and body; anything else → a real
 *  500 with `fallback` (the details go to the log, not to the client). */
export function adminFieldsErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AdminFieldsError) {
    if (error.status >= 500) console.error(fallback, error);
    return NextResponse.json({ error: error.message, code: error.code, ...error.extra }, { status: error.status });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** The request body as a JSON object (400 INVALID_BODY otherwise). */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badBody("Body must be a JSON object");
  }
  if (!isRecord(body)) throw badBody("Body must be a JSON object");
  return body;
}

/** A path segment as a number; NaN for anything but digits. requireId answers 400 INVALID_ID for
 *  NaN and for every number that cannot be an id (0, or beyond int4). */
export function parsePathId(raw: string): number {
  return /^[0-9]{1,15}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** The actor of a signed-in request — the display name resolved as current-user.ts does. */
export function actorFromSession(session: Session): Actor {
  const username = session.user?.preferredUsername ?? "";
  const name = session.user?.displayName ?? session.user?.name ?? username;
  return { username, name: name || null };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Route ids, versions and item type ids are int4 columns: a larger number can name no row, and
 *  Postgres would refuse it as a parameter (a 500) rather than find nothing. */
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;
const isRev = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function badBody(message: string): AdminFieldsError {
  return new AdminFieldsError(400, "INVALID_BODY", message);
}

function requireId(v: number, what: string): void {
  if (!isId(v)) throw new AdminFieldsError(400, "INVALID_ID", `${what} must be a positive integer`);
}

function notFound(routeId: number): AdminFieldsError {
  return new AdminFieldsError(404, "ROUTE_NOT_FOUND", `Route ${routeId} not found`, { route_id: routeId });
}

function stepUnknown(routeId: number, uids: StepUid[]): AdminFieldsError {
  return new AdminFieldsError(409, "STEP_UNKNOWN", `The config names steps route ${routeId} does not have`, {
    route_id: routeId,
    uids,
  });
}

function revOf(raw: unknown): number {
  if (!isRev(raw)) throw badBody("base_rev must be a non-negative integer");
  return raw;
}

/** An incoming config: structure only (spec §2.3) — the sanitized copy is what gets stored. */
function parseIncoming(raw: unknown): RouteFieldsConfig {
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) throw new AdminFieldsError(400, e.code, e.message, { path: e.path });
    throw e;
  }
}

/** A config read back from the database. It was stored parsed, so a failure here is corrupt data:
 *  a real 500, never "no fields". */
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

/** route_ids: a non-empty list of ids, deduplicated and ascending (the lock order). */
function routeIdsOf(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isId)) {
    throw badBody("route_ids must be a non-empty array of route ids");
  }
  const ids = [...new Set(raw)].sort((a, b) => a - b);
  if (ids.length > MAX_ROUTES) throw badBody(`route_ids may name at most ${MAX_ROUTES} routes`);
  return ids;
}

// ---- loading ------------------------------------------------------------------------------------
type RouteRow = {
  test_route_id: number;
  item_type_id: number;
  route_number: number;
  route_steps: number[];
  /** Parallel to route_steps; a different length means the route has no usable uids yet. */
  step_uids: string[];
  /** As stored; null = no draft. */
  fields_draft: unknown;
  draft_rev: number;
  draft_updated_at: Date | null;
  draft_updated_by: string | null;
  fields_version: number;
  item_type_desc: string;
};

/** One route, optionally locked (FOR UPDATE of the testing_routes row only). */
async function loadRoute(db: Db, routeId: number, lock: boolean): Promise<RouteRow | null> {
  const rows = await db.$queryRaw<RouteRow[]>`
    SELECT tr.test_route_id, tr.item_type_id, tr.route_number,
           COALESCE(tr.route_steps, '{}') AS route_steps,
           COALESCE(tr.step_uids, '{}') AS step_uids,
           tr.fields_draft, tr.draft_rev, tr.draft_updated_at, tr.draft_updated_by, tr.fields_version,
           TRIM(t.item_type_desc) AS item_type_desc
      FROM testing_routes tr
      JOIN item_types t ON t.item_type_id = tr.item_type_id
     WHERE tr.test_route_id = ${routeId}
     ${lock ? Prisma.sql`FOR UPDATE OF tr` : Prisma.empty}`;
  return rows[0] ?? null;
}

/** The routes of a batch, one by one in ascending id order — with `lock`, that is the lock order.
 *  A missing route is a 404 for the whole request. */
async function loadRoutes(db: Db, ascendingIds: readonly number[], lock: boolean): Promise<RouteRow[]> {
  const out: RouteRow[] = [];
  for (const id of ascendingIds) {
    const route = await loadRoute(db, id, lock);
    if (!route) throw notFound(id);
    out.push(route);
  }
  return out;
}

/** The config of the route's latest published version; null when never published. Versions are
 *  immutable, so reading it after the route row is always consistent with that row. */
async function loadPublished(db: Db, route: RouteRow): Promise<RouteFieldsConfig | null> {
  if (route.fields_version < 1) return null;
  const row = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: route.test_route_id, version: route.fields_version } },
    select: { config: true },
  });
  if (!row) {
    throw new AdminFieldsError(500, "VERSION_MISSING", `Route ${route.test_route_id} points at version ${route.fields_version}, which does not exist`, {
      route_id: route.test_route_id,
    });
  }
  return parseStored(row.config, route.test_route_id, `version ${route.fields_version}`);
}

/** Kits whose template runs this item route (package_contents.route_number), optionally leaving
 *  out the kit the screen is open on (spec §3.4.2). */
async function kitsUsingRoute(db: Db, itemTypeId: number, routeNumber: number, exceptKit: number | null): Promise<SharedKit[]> {
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
async function prepareDrafts(db: Db, routes: readonly RouteRow[]): Promise<{ prepared: Prepared[]; issues: RouteIssue[] }> {
  const packageLevel = await loadPackageLevelTypeIds(db);
  const prepared: Prepared[] = [];
  const issues: RouteIssue[] = [];
  for (const route of routes) {
    if (route.fields_draft == null) continue;
    const id = route.test_route_id;
    const draft = parseStored(route.fields_draft, id, "draft");
    const published = await loadPublished(db, route);
    for (const issue of configIssues(draft, route, packageLevel)) issues.push({ route_id: id, ...issue });
    prepared.push({ route, draft, published });
  }
  if (issues.some((i) => i.level === "error")) {
    throw new AdminFieldsError(422, "LINT_ERRORS", "The drafts have errors that block publishing", { issues });
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
  if (route.step_uids.length !== route.route_steps.length) return null;
  let first: number | null = null;
  for (const c of changes) {
    const i = route.step_uids.indexOf(c.step_uid);
    if (i >= 0 && (first === null || i + 1 < first)) first = i + 1;
  }
  return first;
}

/**
 * The item_routes rows "גם לפריטים שטרם הגיעו לעמדה ששונתה" moves to the new version (spec §3.4.3
 * step 6): unfinished rows of the route, at or before the first changed step, whose popup is not
 * open yet — status 2 (ממתין) or 6 (ממתין לפריטי המארז) on BOTH sides of the step test, never 1
 * (in test) or 4/5 (research), whose submit would otherwise fail on a changed schema.v. Only rows
 * that froze a version: a row taken in before station fields (NULL) keeps the fixed popups even
 * when its route is published later (spec §8.1, §1.1). One predicate for the UPDATE and the
 * preview count, so the dialog's number is what publish moves.
 */
function notReachedRows(route: RouteRow, minChangedPos: number): Prisma.Sql {
  return Prisma.sql`ir.item_type_id = ${route.item_type_id}
     AND ir.route_number = ${route.route_number}
     AND ir.finished_at IS NULL
     AND ir.fields_version IS NOT NULL
     AND ir.current_status IN (${STATUS_QUEUED}, ${STATUS_WAITING_FOR_PACKAGE_ITEMS})
     AND ir.current_route_step <= ${minChangedPos}`;
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
  const aligned = p.route.step_uids.length === p.route.route_steps.length;
  const out: number[] = [];
  for (const c of changes) {
    if (c.kind === "layout_changed") continue;
    const i = aligned ? p.route.step_uids.indexOf(c.step_uid) : -1;
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
export async function getRouteFields(db: Db, routeId: number): Promise<RouteFieldsView> {
  requireId(routeId, "Route id");
  const route = await loadRoute(db, routeId, false);
  if (!route) throw notFound(routeId);
  const draft = route.fields_draft == null ? null : parseStored(route.fields_draft, routeId, "draft");
  const published = await loadPublished(db, route);
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
    draft_updated_at: route.draft_updated_at,
    draft_updated_by: route.draft_updated_by,
    published_version: route.fields_version,
    published,
    issues: shown ? configIssues(shown, route, await loadPackageLevelTypeIds(db)) : [],
    shared_with: await kitsUsingRoute(db, route.item_type_id, route.route_number, null),
  };
}

/** The 409 of a draft write whose base_rev is stale: the current draft, so the editor can reload. */
function draftConflict(route: RouteRow): AdminFieldsError {
  return new AdminFieldsError(409, "DRAFT_CONFLICT", "The draft changed since base_rev", {
    draft: route.fields_draft ?? null,
    draft_rev: route.draft_rev,
    draft_updated_at: route.draft_updated_at,
    draft_updated_by: route.draft_updated_by,
  });
}

/**
 * PUT …/[id]/fields/draft — autosave (spec §3.4.1). Stores the SANITIZED config and bumps
 * draft_rev. Lint errors never block a draft save; they come back as `issues`.
 */
export async function saveFieldsDraft(db: PrismaClient, routeId: number, input: DraftPutInput, actor: Actor): Promise<DraftSaved> {
  requireId(routeId, "Route id");
  if (!isRecord(input)) throw badBody("Body must be {config, base_rev}");
  const baseRev = revOf(input.base_rev);
  const config = parseIncoming(input.config);
  return db.$transaction(async (tx) => {
    const route = await loadRoute(tx, routeId, true);
    if (!route) throw notFound(routeId);
    if (route.draft_rev !== baseRev) throw draftConflict(route);
    const packageLevel = await loadPackageLevelTypeIds(tx);
    const check = checkConfigAgainstRoute(config, route.route_steps, route.step_uids, packageLevel);
    if (check.unknownUids.length > 0) throw stepUnknown(routeId, check.unknownUids);
    const rows = await tx.$queryRaw<{ draft_rev: number; draft_updated_at: Date }[]>`
      UPDATE testing_routes
         SET fields_draft = ${JSON.stringify(config)}::jsonb,
             draft_rev = draft_rev + 1,
             draft_updated_at = now(),
             draft_updated_by = ${actor.username || null}
       WHERE test_route_id = ${routeId}
      RETURNING draft_rev, draft_updated_at`;
    return {
      draft_rev: rows[0].draft_rev,
      draft_updated_at: rows[0].draft_updated_at,
      issues: [...lintRouteFieldsConfig(config), ...check.issues],
    };
  }, TX_OPTIONS);
}

/** DELETE …/[id]/fields/draft — "ביטול הטיוטה" (spec §3.4.1): back to the published config. */
export async function discardFieldsDraft(db: PrismaClient, routeId: number, input: DraftDeleteInput, actor: Actor): Promise<{ draft_rev: number }> {
  requireId(routeId, "Route id");
  if (!isRecord(input)) throw badBody("Body must be {base_rev}");
  const baseRev = revOf(input.base_rev);
  return db.$transaction(async (tx) => {
    const route = await loadRoute(tx, routeId, true);
    if (!route) throw notFound(routeId);
    if (route.draft_rev !== baseRev) throw draftConflict(route);
    // SQL NULL, never a JSON null: `fields_draft IS NULL` is how every reader tells "no draft".
    const rows = await tx.$queryRaw<{ draft_rev: number }[]>`
      UPDATE testing_routes
         SET fields_draft = NULL,
             draft_rev = draft_rev + 1,
             draft_updated_at = now(),
             draft_updated_by = ${actor.username || null}
       WHERE test_route_id = ${routeId}
      RETURNING draft_rev`;
    return { draft_rev: rows[0].draft_rev };
  }, TX_OPTIONS);
}

/**
 * POST …/fields/publish-preview (spec §3.4.2) — what publishing these routes would do. Read-only,
 * in one REPEATABLE READ snapshot so the counts agree with the drafts they were computed from.
 * context_kit_id: the kit the screen is open on — its route is "מסלול המארז", and it is not
 * "outside" in shared_outside.
 */
export async function previewPublish(db: PrismaClient, input: PublishPreviewInput): Promise<PublishImpact> {
  if (!isRecord(input)) throw badBody("Body must be {route_ids, context_kit_id?}");
  const routeIds = routeIdsOf(input.route_ids);
  const rawKit = input.context_kit_id ?? null;
  if (rawKit !== null && !isId(rawKit)) throw badBody("context_kit_id must be an item type id");
  const contextKit: number | null = rawKit;
  return db.$transaction(async (tx) => {
    const routes = await loadRoutes(tx, routeIds, false);
    const { prepared, issues } = await prepareDrafts(tx, routes);
    const impact: PublishImpact = {
      routes: [],
      totals: { changes: 0, stations: 0, routes: 0 },
      shared_outside: [],
      items_on_routes: 0,
      by_version: [],
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
      if (pos !== null) {
        const rows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM item_routes ir WHERE ${notReachedRows(route, pos)}`;
        impact.not_reached += rows[0]?.n ?? 0;
      }
    }
    impact.totals.stations = stations.size;
    impact.totals.routes = impact.routes.length;
    return impact;
  }, { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/**
 * POST …/fields/publish (spec §3.4.3) — one transaction for the whole batch. Every route is locked
 * (ascending ids) and its draft_rev checked against base_revs before anything is read; each route
 * with a draft becomes version fields_version + 1, all under one publish_batch, and its draft is
 * cleared. apply_mode "not_reached" also moves the rows of notReachedRows to the new version.
 *
 * Every read comes first — the "מולא ב-N בדיקות" counts scan test_results — and the item_routes
 * rows are moved last: a worker's start-test or results submit on such a row waits for its lock,
 * so the lock is taken only once nothing slow is left before the commit.
 */
export async function publishFields(db: PrismaClient, input: PublishInput, actor: Actor): Promise<PublishResult> {
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
    throw new AdminFieldsError(400, "NOTE_TOO_LONG", `note is longer than ${VERSION_NOTE_MAX} characters`, { max: VERSION_NOTE_MAX });
  }
  const note = rawNote?.trim() || null;

  return db.$transaction(async (tx) => {
    const routes = await loadRoutes(tx, routeIds, true);
    const conflicts = routes
      .filter((r) => r.draft_rev !== baseRevs.get(r.test_route_id))
      .map((r) => ({ route_id: r.test_route_id, draft_rev: r.draft_rev }));
    if (conflicts.length > 0) {
      throw new AdminFieldsError(409, "DRAFT_CONFLICT", "A draft changed since base_revs", { conflicts });
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
                ${applyMode}, ${publishBatch}::uuid, ${actor.username || null}, ${actor.name || null})`;
      await tx.$executeRaw`
        UPDATE testing_routes
           SET fields_version = ${v}, fields_draft = NULL, draft_rev = draft_rev + 1
         WHERE test_route_id = ${id}`;
      versions[id] = v;
    }

    // Last: the rows that have not reached a changed step yet.
    let bumped = 0;
    if (applyMode === "not_reached") {
      for (const { p, v, changes } of planned) {
        const pos = firstChangedPosition(changes, p.route);
        if (pos !== null) {
          bumped += await tx.$executeRaw`UPDATE item_routes ir SET fields_version = ${v} WHERE ${notReachedRows(p.route, pos)}`;
        }
      }
    }
    return { publish_batch: publishBatch, versions, bumped_items: bumped };
  }, TX_OPTIONS);
}

/** GET …/[id]/fields/versions — "היסטוריית גרסאות", newest first. */
export async function listFieldVersions(db: Db, routeId: number): Promise<FieldVersionSummary[]> {
  requireId(routeId, "Route id");
  const route = await db.testing_routes.findUnique({ where: { test_route_id: routeId }, select: { test_route_id: true } });
  if (!route) throw notFound(routeId);
  const rows = await db.route_field_versions.findMany({
    where: { test_route_id: routeId },
    orderBy: { version: "desc" },
    select: { version: true, published_at: true, published_by_name: true, note: true, apply_mode: true, publish_batch: true, changes: true },
  });
  return rows.map((r) => ({ ...r, changes: r.changes as unknown as Change[] | null }));
}

/** GET …/[id]/fields/versions/[v] — one published version, whole (as stored at publish). */
export async function getFieldVersion(db: Db, routeId: number, version: number): Promise<FieldVersionRow> {
  requireId(routeId, "Route id");
  requireId(version, "Version");
  const row = await db.route_field_versions.findUnique({
    where: { test_route_id_version: { test_route_id: routeId, version } },
  });
  if (!row) {
    throw new AdminFieldsError(404, "VERSION_NOT_FOUND", `Route ${routeId} has no version ${version}`, { route_id: routeId, version });
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
    published_at: row.published_at,
    published_by: row.published_by,
    published_by_name: row.published_by_name,
  };
}
