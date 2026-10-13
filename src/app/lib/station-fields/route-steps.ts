import { Prisma } from "@prisma/client";
import type { TransactionClient } from "@/app/lib/prisma";
import type { RouteFieldsConfig, StepUid } from "./schema";
import {
  StepUidError,
  assignStepUids,
  inferUidsByOccurrence,
  newStepUid,
  pruneDraft,
  renameStationTypeInConfig,
} from "./step-uids";
import type { StationTypeInfo, StepUidErrorCode } from "./step-uids";
import { ShapeError, parseRouteFieldsConfig } from "./validate";

/**
 * SERVER ONLY. The routes API's reads and writes of testing_routes.route_steps / step_uids
 * (route-fields spec §3.1, §3.5), and the station-type id rename's pass over the drafts (§3.6).
 *
 * Plain functions over a Prisma client or transaction, so they run without a session; the route
 * handlers only add withAuth and turn a RouteStepsError into its HTTP status. The rules
 * themselves (uid assignment, inference, pruning, renaming) live in step-uids.ts.
 */

type Db = Pick<TransactionClient, "$queryRaw" | "testing_routes">;

/** Response texts. The first four are word for word what the handlers answered before. */
const MESSAGES = {
  required: "Item Type and Route Number are required",
  exists: "מסלול עבור שילוב זה כבר קיים במערכת",
  noFirstStep: "לא ניתן לקבוע סוג עמדה התחלתית. נא להוסיף שלב למסלול תחילה.",
  notFound: "Route not found",
  // Developer-facing: the settings page sends the ids of the station types it lists, so it meets
  // unknownType only when the type of the step it puts first was deleted meanwhile.
  badFilter: "itemTypeId and routeNumber must be integers",
  badSteps: "route_steps must be an array of integers",
  badUids: "step_uids must be an array of step uids or nulls, one per step",
  unknownType: "route_steps starts with a station type that does not exist",
} as const;

/**
 * A request the routes API refuses: `status` is the HTTP status, `message` the body's `error`,
 * `code` set only for a step uid refusal (STEP_UID_UNKNOWN / STEP_UID_DUPLICATE, spec §3.5).
 */
export class RouteStepsError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code?: StepUidErrorCode;
  constructor(status: 400 | 404 | 409, message: string, code?: StepUidErrorCode) {
    super(message);
    this.name = "RouteStepsError";
    this.status = status;
    this.code = code;
  }
  /** The JSON body to answer with: `{ error }` as these handlers always answered, plus `code`
   *  when there is one. */
  get body(): { error: string; code?: StepUidErrorCode } {
    return this.code ? { error: this.message, code: this.code } : { error: this.message };
  }
}

const isInt4 = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseRouteSteps(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.every(isInt4)) throw new RouteStepsError(400, MESSAGES.badSteps);
  return [...raw];
}

/** body.step_uids: absent / null = "not sent" (→ inferred); otherwise one string or null per step. */
function parseStepUids(raw: unknown, steps: number): (string | null)[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== steps || !raw.every((u) => u === null || typeof u === "string")) {
    throw new RouteStepsError(400, MESSAGES.badUids);
  }
  return [...raw];
}

/** The step uids a raw stored config holds a config for (own keys of its `steps`). */
function configuredStepUids(raw: unknown): Set<string> {
  return isRecord(raw) && isRecord(raw.steps) ? new Set(Object.keys(raw.steps)) : new Set();
}

// ---- GET /api/settings/testing-routes ------------------------------------------------------
/** One route of the list. fields_draft itself is never part of it (it has its own endpoint). */
export type RouteListRow = {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
  /** Parallel to route_steps. A different length means a route without uids (a script inserted
   *  it): readers treat every step as uid-less. */
  step_uids: string[];
  /** Latest published version; 0 = never published. */
  fields_version: number;
  draft_rev: number;
  /** fields_draft IS NOT NULL — there are unpublished changes. */
  has_draft: boolean;
};

export async function listRoutes(
  db: Pick<TransactionClient, "$queryRaw">,
  filters: { itemTypeId?: number | null; routeNumber?: number | null } = {},
): Promise<RouteListRow[]> {
  const itemTypeId = filters.itemTypeId ?? null;
  const routeNumber = filters.routeNumber ?? null;
  if ((itemTypeId !== null && !isInt4(itemTypeId)) || (routeNumber !== null && !isInt4(routeNumber))) {
    throw new RouteStepsError(400, MESSAGES.badFilter);
  }
  return db.$queryRaw<RouteListRow[]>`
    SELECT test_route_id, item_type_id, test_station_type_id, route_number,
           COALESCE(route_steps, ARRAY[]::int[]) AS route_steps,
           COALESCE(step_uids, ARRAY[]::text[])  AS step_uids,
           fields_version, draft_rev,
           fields_draft IS NOT NULL               AS has_draft
      FROM testing_routes
     WHERE (${itemTypeId}::int IS NULL OR item_type_id = ${itemTypeId}::int)
       AND (${routeNumber}::int IS NULL OR route_number = ${routeNumber}::int)
     ORDER BY test_route_id
  `;
}

// ---- POST /api/settings/testing-routes -----------------------------------------------------
export type CreatedRoute = {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
  step_uids: StepUid[];
};

const ROUTE_SELECT = {
  test_route_id: true,
  item_type_id: true,
  test_station_type_id: true,
  route_number: true,
  route_steps: true,
  step_uids: true,
} as const;

/**
 * A new route: body { item_type_id, route_number, route_steps }. Every step gets a new uid — a new
 * route has no uids to keep, so step_uids in the body are ignored (spec §3.5). The route's
 * test_station_type_id is its first step's, else that of another route of the same item type.
 */
export async function createRoute(db: Pick<TransactionClient, "testing_routes">, body: unknown): Promise<CreatedRoute> {
  const b = isRecord(body) ? body : {};
  const itemTypeId = b.item_type_id;
  const routeNumber = b.route_number;
  if (!itemTypeId || routeNumber === undefined || routeNumber === null || !isInt4(itemTypeId) || !isInt4(routeNumber)) {
    throw new RouteStepsError(400, MESSAGES.required);
  }
  const routeSteps = parseRouteSteps(b.route_steps || []);

  const existing = await db.testing_routes.findFirst({
    where: { item_type_id: itemTypeId, route_number: routeNumber },
    select: { test_route_id: true },
  });
  if (existing) throw new RouteStepsError(409, MESSAGES.exists);

  let testStationTypeId: number | null = routeSteps.length > 0 ? routeSteps[0] : null;
  if (testStationTypeId === null) {
    const anyRoute = await db.testing_routes.findFirst({
      where: { item_type_id: itemTypeId },
      select: { test_station_type_id: true },
    });
    testStationTypeId = anyRoute?.test_station_type_id ?? null;
  }
  if (!testStationTypeId) throw new RouteStepsError(400, MESSAGES.noFirstStep);

  const stepUids = assignStepUids([], routeSteps.map(() => null), new Set());
  try {
    return await db.testing_routes.create({
      data: {
        item_type_id: itemTypeId,
        test_station_type_id: testStationTypeId,
        route_number: routeNumber,
        route_steps: routeSteps,
        step_uids: stepUids,
      },
      select: ROUTE_SELECT,
    });
  } catch (e) {
    // Lost a race with an identical POST: the unique index testing_routes_type_number_uq refused it.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new RouteStepsError(409, MESSAGES.exists);
    }
    throw e;
  }
}

// ---- PUT /api/settings/testing-routes/[id] -------------------------------------------------
export type SavedRoute = CreatedRoute & {
  /** Uids this save removed from the route whose step had a config in the draft or in the latest
   *  published version: removing the step deleted those fields (spec §3.1). */
  removed_with_fields: StepUid[];
};

/** Every step uid any published version of the route holds a config for. A new step is never given
 *  one of them, so a removed step's config cannot come back on another step. */
export async function publishedStepUids(db: Pick<TransactionClient, "$queryRaw">, routeId: number): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ uid: string }[]>`
    SELECT DISTINCT s.uid
      FROM route_field_versions v
     CROSS JOIN LATERAL jsonb_object_keys(
             CASE WHEN jsonb_typeof(v.config -> 'steps') = 'object' THEN v.config -> 'steps' ELSE '{}'::jsonb END
           ) AS s(uid)
     WHERE v.test_route_id = ${routeId}::int
  `;
  return new Set(rows.map((r) => r.uid));
}

/** route_field_versions.config of the route's latest published version (testing_routes.fields_version),
 *  exactly as stored; null when it was never published. */
async function latestPublishedConfig(db: Pick<TransactionClient, "$queryRaw">, routeId: number, version: number): Promise<unknown> {
  if (!(version > 0)) return null;
  const rows = await db.$queryRaw<{ config: unknown }[]>`
    SELECT config FROM route_field_versions
     WHERE test_route_id = ${routeId}::int AND version = ${version}::int
  `;
  return rows[0]?.config ?? null;
}

/** test_stations_type facts pruneDraft needs for the route's station types. CHAR(50): trimmed. */
async function stationTypeInfo(db: Pick<TransactionClient, "$queryRaw">, typeIds: readonly number[]): Promise<Map<number, StationTypeInfo>> {
  const ids = [...new Set(typeIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.$queryRaw<{ id: number; label: string; package_level: boolean }[]>`
    SELECT test_station_type_id AS id, TRIM(test_type_desc) AS label, package_level
      FROM test_stations_type
     WHERE test_station_type_id = ANY(${ids}::int[])
  `;
  return new Map(rows.map((r) => [r.id, { label: r.label, package_level: r.package_level }]));
}

/**
 * A step uid belongs to its station type (spec §3.5: changing a step's type is a removal plus an
 * addition). A kept uid sent for a step of another type than the one it stands on now is that step
 * removed and a new one added: it gets a fresh uid, so its config is pruned (and reported in
 * removed_with_fields) instead of moving onto another station. The old uid stays in `taken`, so it
 * is never minted again. `current` / `curSteps`: the route's aligned uids and steps before the save.
 */
function rebindRetypedSteps(
  assigned: readonly StepUid[],
  current: readonly string[],
  curSteps: readonly number[],
  routeSteps: readonly number[],
  taken: ReadonlySet<string>,
): StepUid[] {
  const used = new Set([...taken, ...assigned]);
  return assigned.map((uid, i) => {
    const at = current.indexOf(uid);
    if (at < 0 || curSteps[at] === routeSteps[i]) return uid;
    const fresh = newStepUid(used);
    used.add(fresh);
    return fresh;
  });
}

/** A stored config, parsed; null (and logged) when it does not parse — a route save must never
 *  fail on a draft or version it cannot read, and such a config is left exactly as it is. */
function parseStored(raw: unknown, routeId: number, what: string): RouteFieldsConfig | null {
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (!(e instanceof ShapeError)) throw e;
    console.warn(`testing route ${routeId}: the ${what} does not parse (${e.message}); left unpruned`);
    return null;
  }
}

/**
 * Saves a route's steps (spec §3.1, §3.5). Body { route_steps, step_uids? }: route_steps the new
 * station type ids in order; step_uids, when sent, one entry per step — the uid the step had, or
 * null for a new step (a uid sent with another station type than its own is a new step too, see
 * rebindRetypedSteps). Without step_uids (the seed scripts, today's settings page) each step keeps
 * the uid of the current step with the same station type and occurrence, so re-sending the same
 * steps keeps every uid.
 *
 * In ONE update: route_steps, step_uids, test_station_type_id = the first step's (kept when the
 * route is emptied), and — only when it changes — the draft. The draft (or, without one, the
 * latest published config) loses the configs of removed steps and gets each kept step's station
 * type / label from its new position; a published version is a base only when pruning changes
 * it. Published versions themselves are never touched.
 *
 * Run inside a transaction: the route row is locked FOR UPDATE first. `actor` = the session's
 * preferredUsername, stored as draft_updated_by when the draft changes.
 */
export async function saveRouteSteps(
  tx: Db,
  routeId: number,
  body: unknown,
  actor: string | null,
): Promise<SavedRoute> {
  const b = isRecord(body) ? body : {};
  const routeSteps = parseRouteSteps(b.route_steps);
  const sentUids = parseStepUids(b.step_uids, routeSteps.length);
  if (!isInt4(routeId) || routeId < 1) throw new RouteStepsError(404, MESSAGES.notFound);

  const rows = await tx.$queryRaw<{
    route_steps: number[] | null;
    step_uids: string[] | null;
    fields_draft: unknown;
    fields_version: number;
  }[]>`
    SELECT route_steps, step_uids, fields_draft, fields_version
      FROM testing_routes
     WHERE test_route_id = ${routeId}::int
       FOR UPDATE
  `;
  const cur = rows[0];
  if (!cur) throw new RouteStepsError(404, MESSAGES.notFound);
  const curSteps = cur.route_steps ?? [];
  const curUids = cur.step_uids ?? [];
  // A route a script inserted (or edited) without step_uids has none that line up with its steps.
  const current = curUids.length === curSteps.length ? curUids : [];
  const incoming = sentUids ?? inferUidsByOccurrence(curSteps, curUids, routeSteps);

  const latestPublished = await latestPublishedConfig(tx, routeId, cur.fields_version);
  const draftUids = configuredStepUids(cur.fields_draft);
  // A new step never gets a uid some config still names: any published version's (spec §3.5
  // rule 3), the draft's, or a stale one left beside misaligned steps.
  const taken = new Set([...(await publishedStepUids(tx, routeId)), ...draftUids, ...curUids]);

  let stepUids: StepUid[];
  try {
    stepUids = assignStepUids(current, incoming, taken);
  } catch (e) {
    if (e instanceof StepUidError) throw new RouteStepsError(400, e.message, e.code);
    throw e;
  }
  stepUids = rebindRetypedSteps(stepUids, current, curSteps, routeSteps, taken);
  const kept = new Set(stepUids);
  const removed = current.filter((uid) => !kept.has(uid));
  const latestPublishedUids = configuredStepUids(latestPublished);
  const removedWithFields = removed.filter((uid) => draftUids.has(uid) || latestPublishedUids.has(uid));

  let nextDraft: RouteFieldsConfig | null = null;
  const base = cur.fields_draft ?? latestPublished;
  if (base != null) {
    const parsed = parseStored(base, routeId, cur.fields_draft != null ? "draft" : `published version ${cur.fields_version}`);
    if (parsed) {
      const pruned = pruneDraft(parsed, stepUids, routeSteps, await stationTypeInfo(tx, routeSteps));
      if (pruned.changed) nextDraft = pruned.config;
    }
  }

  try {
    const saved = await tx.testing_routes.update({
      where: { test_route_id: routeId },
      data: {
        route_steps: routeSteps,
        step_uids: stepUids,
        // The first station type, which this PUT used to leave stale. The column is NOT NULL, so an
        // emptied route keeps the one it had.
        ...(routeSteps.length > 0 ? { test_station_type_id: routeSteps[0] } : {}),
        ...(nextDraft
          ? {
              fields_draft: nextDraft as unknown as Prisma.InputJsonValue,
              draft_rev: { increment: 1 },
              draft_updated_at: new Date(),
              draft_updated_by: actor,
            }
          : {}),
      },
      select: ROUTE_SELECT,
    });
    return { ...saved, removed_with_fields: removedWithFields };
  } catch (e) {
    // fk_testing_routes_test_station_type: route_steps[0] names no station type.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new RouteStepsError(400, MESSAGES.unknownType);
    }
    throw e;
  }
}

// ---- PUT /api/settings/test-stations-type/[id] (id change) -----------------------------------
/**
 * A station type's id changed (spec §3.6): every draft that names the old id as a step's
 * informational station_type_id is rewritten to the new one. Only drafts that change are written;
 * draft_rev stays (nothing the admin edited changed), step_uids stay (no step moved), and published
 * versions are history — never touched. Run inside the rename's transaction. Returns the number
 * of drafts rewritten.
 */
export async function renameStationTypeInDrafts(tx: Db, oldId: number, newId: number): Promise<number> {
  if (oldId === newId) return 0;
  const drafts = await tx.$queryRaw<{ test_route_id: number; fields_draft: unknown }[]>`
    SELECT test_route_id, fields_draft
      FROM testing_routes
     WHERE fields_draft IS NOT NULL
     ORDER BY test_route_id
       FOR UPDATE
  `;
  let rewritten = 0;
  for (const d of drafts) {
    const next = renameStationTypeInConfig(d.fields_draft, oldId, newId);
    if (!next) continue;
    await tx.testing_routes.update({
      where: { test_route_id: d.test_route_id },
      data: { fields_draft: next as unknown as Prisma.InputJsonValue },
      select: { test_route_id: true },
    });
    rewritten++;
  }
  return rewritten;
}
