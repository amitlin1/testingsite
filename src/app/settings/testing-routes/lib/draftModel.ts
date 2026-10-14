import { diffConfigs } from "@/app/lib/station-fields/diff";
import type { Change } from "@/app/lib/station-fields/diff";
import { stepConfigOf, targetKey } from "@/app/lib/station-fields/schema";
import type { Field, FieldGroup, RouteFieldsConfig, StepConfig } from "@/app/lib/station-fields/schema";
import { checkConfigAgainstRoute, lintRouteFieldsConfig, unknownStepIssues } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import type { DraftSavedJson, FieldsContextJson, RouteFieldsJson, SharedKitJson } from "@/app/lib/station-fields/admin-types";
// Types only: mapModel imports this module's helpers at run time.
import type { CellBinding, StepMeta } from "./mapModel";

/**
 * The admin screen's working copy of every route in the fields map (route-fields spec §3.4.1,
 * §5.2, D6) — the pure half of draftStore.ts: state, the reducer, and the derived counts.
 *
 * One entry per test_route_id of the context (the kit route and each line's item route):
 *   published    the config of the published version (null = never published)
 *   serverDraft  the draft the server holds as far as we know (null = none)
 *   current      what the editor shows and edits: serverDraft ?? published ?? {schema:1, steps:{}}
 *   rev          draft_rev of serverDraft — the base_rev of the next PUT / DELETE
 *   dirty        current differs from what the server holds (a PUT is due)
 *   saving       a PUT or a DELETE is in flight; `inFlight` is the config the PUT carries
 *   error        the last PUT / DELETE failed (network, 5xx, or refused)
 *   conflict     409 DRAFT_CONFLICT: the server's draft and rev — no PUT until it is resolved
 *   savedAt      draft_updated_at of the last save we know of
 *
 * Every action returns a new state; entries are replaced, never mutated, so a component can keep
 * an entry and compare it by identity. Configs are JSON: copies are JSON round trips.
 */

// ---- state -------------------------------------------------------------------------------------
export type SaveOp = "put" | "delete";

/** A write that failed: no answer / not JSON ("network"), a 5xx ("server"), or a refusal that a
 *  retry will not fix on its own — 400 SHAPE_INVALID, 404, 409 STEP_UNKNOWN… ("rejected"). */
export type SaveError =
  | { kind: "network"; op: SaveOp }
  | { kind: "server"; op: SaveOp; status: number }
  | { kind: "rejected"; op: SaveOp; status: number; code: string | null };

/** 409 DRAFT_CONFLICT: what the server holds now. */
export type DraftConflict = {
  draft: RouteFieldsConfig | null;
  rev: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type RouteDraft = {
  routeId: number;
  route: RouteFieldsJson["route"];
  published: RouteFieldsConfig | null;
  publishedVersion: number;
  serverDraft: RouteFieldsConfig | null;
  current: RouteFieldsConfig;
  rev: number;
  dirty: boolean;
  saving: boolean;
  /** The config the PUT in flight carries (null for a DELETE, or when nothing is in flight). */
  inFlight: RouteFieldsConfig | null;
  error: SaveError | null;
  conflict: DraftConflict | null;
  savedAt: string | null;
  updatedBy: string | null;
  /** The server's issues from its last answer (GET or PUT). The screen recomputes its own. */
  serverIssues: Issue[];
  sharedWith: SharedKitJson[];
};

export type DraftModel = {
  routes: Readonly<Record<number, RouteDraft>>;
  /** The context's routes in map order: the kit (or the item route), then each line's. An entry
   *  that left the context while it still had a save to make stays in `routes`, outside `order`. */
  order: readonly number[];
  /** Station type ids with package_level (context.stations) — checkConfigAgainstRoute's input. */
  packageLevel: readonly number[];
};

export const EMPTY_DRAFT_MODEL: DraftModel = Object.freeze({ routes: Object.freeze({}), order: Object.freeze([]), packageLevel: Object.freeze([]) });

/** A fresh empty config ({schema:1, steps:{}}). */
export function emptyConfig(): RouteFieldsConfig {
  return { schema: 1, steps: {} };
}

/** A deep copy — configs are JSON. */
export function copyConfig(cfg: RouteFieldsConfig): RouteFieldsConfig {
  return JSON.parse(JSON.stringify(cfg)) as RouteFieldsConfig;
}

/** Structural equality of JSON values, key order ignored (an `undefined` member = absent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  if (keys.length !== Object.keys(bo).filter((k) => bo[k] !== undefined).length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}

/** The routes of a context: the kit (or the item route), then each line's in sort_order — each
 *  route once (two lines may run the same route). */
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
  add(ctx.item);
  for (const l of sortedLines(ctx)) add(l.route);
  return out;
}

export function contextRouteIds(ctx: FieldsContextJson): number[] {
  return contextRoutes(ctx).map((r) => r.route.test_route_id);
}

/** The same steps: route_steps and step_uids alike, in order. */
function sameSteps(a: RouteFieldsJson["route"], b: RouteFieldsJson["route"]): boolean {
  return a.route_steps.length === b.route_steps.length && a.route_steps.every((t, i) => t === b.route_steps[i])
    && a.step_uids.length === b.step_uids.length && a.step_uids.every((u, i) => u === b.step_uids[i]);
}

/**
 * The routes of `ctx` whose entry holds OTHER steps than the context does — a route read back on its
 * own (draftStore.reloadRoute after a 409 STEP_UNKNOWN) with steps that changed under the draft. The
 * map's columns come from the context, so it is out of date until it is asked for again. "" when
 * none; else "{route id}:{step uids}" per route, so each change of steps is a key of its own.
 */
export function stepsOutOfContextKey(state: DraftModel, ctx: FieldsContextJson): string {
  const parts: string[] = [];
  for (const r of contextRoutes(ctx)) {
    const e = state.routes[r.route.test_route_id];
    if (e && !sameSteps(e.route, r.route)) parts.push(e.routeId + ":" + e.route.step_uids.join(","));
  }
  return parts.join(" ");
}

/** The template lines in map order: sort_order, then line id. */
export function sortedLines(ctx: FieldsContextJson): FieldsContextJson["lines"] {
  return [...ctx.lines].sort((a, z) => a.sort_order - z.sort_order || a.line_id - z.line_id);
}

/** What the server holds for the route: its draft, else the published config, else nothing. */
function serverBaseline(e: Pick<RouteDraft, "serverDraft" | "published">): RouteFieldsConfig {
  return e.serverDraft ?? e.published ?? emptyConfig();
}

/** The entry for a route as the server answered it (GET …/[id]/fields or one route of the context). */
export function entryFromServer(r: RouteFieldsJson): RouteDraft {
  const current = copyConfig(r.draft ?? r.published ?? emptyConfig());
  return {
    routeId: r.route.test_route_id,
    route: r.route,
    published: r.published,
    publishedVersion: r.published_version,
    serverDraft: r.draft,
    current,
    rev: r.draft_rev,
    dirty: false,
    saving: false,
    inFlight: null,
    error: null,
    conflict: null,
    savedAt: r.draft ? r.draft_updated_at : null,
    updatedBy: r.draft ? r.draft_updated_by : null,
    serverIssues: r.issues,
    sharedWith: r.shared_with,
  };
}

/** Local work the server does not have yet, or a write in flight. */
const hasLocalWork = (e: RouteDraft): boolean => e.saving || e.dirty || e.conflict != null;

/** A route that still needs a PUT that nothing stops (no conflict). */
const needsSave = (e: RouteDraft): boolean => e.saving || (e.dirty && e.conflict == null);

// ---- actions -----------------------------------------------------------------------------------
/** `mutate` receives a deep copy of `current` and either changes it in place or returns the next
 *  config. */
export type ConfigMutator = (cfg: RouteFieldsConfig) => RouteFieldsConfig | void;

export type DraftAction =
  /** The context (re)loaded: entries merge by route id (see mergeRoute). */
  | { type: "load"; context: FieldsContextJson }
  /** One route answered GET …/[id]/fields: replace the entry, dropping local work ("טען מחדש"). */
  | { type: "routeLoaded"; route: RouteFieldsJson }
  | { type: "edit"; routeId: number; mutate: ConfigMutator }
  | { type: "saveStart"; routeId: number }
  | { type: "saveDone"; routeId: number; result: DraftSavedJson }
  | { type: "discardStart"; routeId: number }
  | { type: "discardDone"; routeId: number; rev: number }
  /** No server draft: back to the published config without a request. */
  | { type: "discardLocal"; routeId: number }
  | { type: "conflict"; routeId: number; op: SaveOp; conflict: DraftConflict }
  | { type: "fail"; routeId: number; error: SaveError }
  /** Drop an entry outside the context once it has nothing left to save. */
  | { type: "evict"; routeId: number };

/** The reducer. An action for a route the model does not hold leaves the state as it is. */
export function draftReducer(state: DraftModel, action: DraftAction): DraftModel {
  if (action.type === "load") return loadContext(state, action.context);
  if (action.type === "routeLoaded") {
    return withEntry(state, entryFromServer(action.route));
  }
  const e = state.routes[action.routeId];
  if (!e) return state;
  switch (action.type) {
    case "edit": {
      const copy = copyConfig(e.current);
      const next = action.mutate(copy) ?? copy;
      return withEntry(state, { ...e, current: next, dirty: !jsonEqual(next, serverBaseline(e)) });
    }
    case "saveStart":
      if (e.saving) return state;
      return withEntry(state, { ...e, saving: true, inFlight: e.current, error: null });
    case "saveDone": {
      const saved = e.inFlight ?? e.current;
      return withEntry(state, {
        ...e,
        serverDraft: saved,
        rev: action.result.draft_rev,
        savedAt: action.result.draft_updated_at,
        serverIssues: action.result.issues,
        saving: false,
        inFlight: null,
        error: null,
        dirty: !jsonEqual(e.current, saved),
      });
    }
    case "discardStart":
      if (e.saving) return state;
      return withEntry(state, { ...e, saving: true, inFlight: null, error: null });
    case "discardDone":
      return withEntry(state, resetToPublished(e, action.rev));
    case "discardLocal":
      // In conflict the server's rev is the conflict's (its draft is null here, or a DELETE runs).
      return withEntry(state, resetToPublished(e, e.conflict ? e.conflict.rev : e.rev));
    case "conflict": {
      const c = action.conflict;
      // The write already happened and only its answer was lost: the server holds exactly what was
      // sent (a PUT is idempotent with base_rev, spec §3.2) — or, for a DELETE, no draft at all.
      if (action.op === "put" && e.inFlight && c.draft && jsonEqual(c.draft, e.inFlight)) {
        return withEntry(state, {
          ...e, serverDraft: e.inFlight, rev: c.rev, savedAt: c.updatedAt, updatedBy: c.updatedBy,
          saving: false, inFlight: null, error: null, dirty: !jsonEqual(e.current, e.inFlight),
        });
      }
      if (action.op === "delete" && c.draft == null) return withEntry(state, resetToPublished(e, c.rev));
      return withEntry(state, { ...e, saving: false, inFlight: null, conflict: c });
    }
    case "fail":
      return withEntry(state, { ...e, saving: false, inFlight: null, error: action.error });
    case "evict": {
      if (state.order.includes(e.routeId) || hasLocalWork(e)) return state;
      const routes = { ...state.routes };
      delete routes[e.routeId];
      return { ...state, routes };
    }
  }
}

function withEntry(state: DraftModel, e: RouteDraft): DraftModel {
  return { ...state, routes: { ...state.routes, [e.routeId]: e } };
}

/** "ביטול הטיוטה" done: no draft, the published config, nothing pending. */
function resetToPublished(e: RouteDraft, rev: number): RouteDraft {
  return {
    ...e,
    serverDraft: null,
    current: copyConfig(e.published ?? emptyConfig()),
    rev,
    dirty: false,
    saving: false,
    inFlight: null,
    error: null,
    conflict: null,
    savedAt: null,
    updatedBy: null,
  };
}

/**
 * One route of a (re)loaded context against the entry we hold:
 *   - no entry → the server's;
 *   - an entry without local work → the server's, unless the answer is older than our last write
 *     (its draft_rev below ours: it was read before our PUT landed);
 *   - an entry with local work keeps its working copy and takes what the server owns (steps,
 *     published, kits). A draft_rev that moved past ours while nothing of ours was in flight means
 *     someone else wrote: a conflict — unless the server already holds exactly our working copy.
 */
export function mergeRoute(prev: RouteDraft | undefined, r: RouteFieldsJson): RouteDraft {
  if (!prev) return entryFromServer(r);
  if (!hasLocalWork(prev)) return r.draft_rev >= prev.rev ? entryFromServer(r) : prev;
  if (r.draft_rev < prev.rev) return prev;
  const next: RouteDraft = {
    ...prev,
    route: r.route,
    published: r.published,
    publishedVersion: r.published_version,
    sharedWith: r.shared_with,
  };
  const serverNow: DraftConflict = { draft: r.draft, rev: r.draft_rev, updatedAt: r.draft_updated_at, updatedBy: r.draft_updated_by };
  if (!prev.saving && prev.conflict != null) {
    // Still in conflict: keep the newest server state, the one "טען מחדש" / a discard builds on.
    if (r.draft_rev > prev.conflict.rev) next.conflict = serverNow;
  } else if (!prev.saving && r.draft_rev > prev.rev) {
    if (r.draft && jsonEqual(r.draft, prev.current)) {
      return { ...next, serverDraft: r.draft, rev: r.draft_rev, savedAt: r.draft_updated_at, updatedBy: r.draft_updated_by, dirty: false, error: null };
    }
    next.conflict = serverNow;
  }
  next.dirty = !jsonEqual(next.current, serverBaseline(next));
  return next;
}

function loadContext(state: DraftModel, ctx: FieldsContextJson): DraftModel {
  const incoming = contextRoutes(ctx);
  const routes: Record<number, RouteDraft> = {};
  for (const r of incoming) routes[r.route.test_route_id] = mergeRoute(state.routes[r.route.test_route_id], r);
  // A route that left the context keeps its entry only while a save of it is still due.
  for (const e of Object.values(state.routes)) {
    if (!(e.routeId in routes) && needsSave(e)) routes[e.routeId] = e;
  }
  const packageLevel = Object.entries(ctx.stations)
    .filter(([, s]) => s.package_level)
    .map(([id]) => Number(id))
    .sort((a, b) => a - b);
  return { routes, order: incoming.map((r) => r.route.test_route_id), packageLevel };
}

// ---- config helpers (the editor and the bulk actions) --------------------------------------------
/**
 * The config with the group `binding.target` of step `binding.step_uid` holding `fields`. A missing
 * step is created from `meta` (station type, label and scope of the map column); an emptied group
 * is removed, and so is a step left without groups or layout — so undoing an edit gives back the
 * config the server holds, and no empty step is ever published. Mutates and returns `cfg` (pass
 * the copy `edit` hands out).
 */
export function setGroupFields(cfg: RouteFieldsConfig, binding: Pick<CellBinding, "step_uid" | "target">, meta: StepMeta, fields: Field[]): RouteFieldsConfig {
  const uid = binding.step_uid;
  const key = targetKey(binding.target);
  const existing = stepConfigOf(cfg, uid);
  const step: StepConfig = existing ?? {
    uid,
    station_type_id: meta.station_type_id,
    station_label: meta.station_label.slice(0, 50),
    scope: meta.scope,
    groups: [],
  };
  const groups: FieldGroup[] = step.groups.filter((g) => targetKey(g.target) !== key);
  if (fields.length > 0) {
    const at = step.groups.findIndex((g) => targetKey(g.target) === key);
    const group: FieldGroup = { target: binding.target, fields };
    if (at >= 0) groups.splice(Math.min(at, groups.length), 0, group);
    else groups.push(group);
  }
  // Nothing to clear in a step the config never had.
  if (!existing && fields.length === 0) return cfg;
  // An emptied step is KEPT (groups []), never deleted: deleting it would make the diff report a
  // step removal instead of the removed fields, and the publish dialog would lose their
  // "מולא ב-N בדיקות" warning. An empty step resolves to the fixed popup like an absent one.
  cfg.steps[uid] = { ...step, groups };
  return cfg;
}

// ---- derived -------------------------------------------------------------------------------------
/** The route has a draft: on the server, or about to be (unsaved edits). */
export function entryHasDraft(e: RouteDraft): boolean {
  return e.serverDraft != null || e.dirty;
}

type Derived = { packageLevel: readonly number[]; changes: Change[]; issues: Issue[] };
const derivedCache = new WeakMap<RouteDraft, Derived>();

/** diffConfigs(published, current) and lint + the route check of `current` — cached per entry
 *  (entries are immutable), so a keystroke in one route recomputes that route only. */
function derive(e: RouteDraft, packageLevel: readonly number[]): Derived {
  const hit = derivedCache.get(e);
  if (hit && hit.packageLevel === packageLevel) return hit;
  const check = checkConfigAgainstRoute(e.current, e.route.route_steps, e.route.step_uids, new Set(packageLevel));
  const d: Derived = {
    packageLevel,
    changes: diffConfigs(e.published, e.current, e.routeId),
    // The same list GET …/fields answers (admin.ts configIssues): what publish would refuse.
    issues: [...lintRouteFieldsConfig(e.current), ...check.issues, ...unknownStepIssues(check.unknownUids)],
  };
  derivedCache.set(e, d);
  return d;
}

/** "What changed" of one route since its published version. */
export function routeChanges(model: DraftModel, routeId: number): Change[] {
  const e = model.routes[routeId];
  return e ? derive(e, model.packageLevel).changes : [];
}

/** Lint + route check of one route's working copy. */
export function routeIssues(model: DraftModel, routeId: number): Issue[] {
  const e = model.routes[routeId];
  return e ? derive(e, model.packageLevel).issues : [];
}

export type DraftSummary = {
  /** Σ diffConfigs(published, current).length over the context — "טיוטה · 6 שינויים". */
  changeCount: number;
  changesByRoute: Readonly<Record<number, Change[]>>;
  issuesByRoute: Readonly<Record<number, Issue[]>>;
  /** Errors over the context (what the map marks). */
  errorCount: number;
  /** Errors of the routes that have a draft — what publish refuses (422): "בעיה אחת לתיקון". */
  blockingErrorCount: number;
  /** Some route of the context has a draft (on the server, or unsaved edits). */
  hasDraft: boolean;
  /** A draft that changes nothing against the published version (e.g. an edit undone after it
   *  was saved): nothing to publish, yet "ביטול הטיוטה" has a draft to delete. */
  isNoopDraft: boolean;
  /** The routes of the context that have a draft — the route_ids of publish-preview / publish. */
  draftRouteIds: number[];
  /** The latest savedAt (ISO) over the context, or null. */
  lastSavedAt: string | null;
  /** A write is in flight. */
  saving: boolean;
  /** Edits not on the server yet (in flight, waiting for the debounce, failed or in conflict). */
  unsaved: boolean;
  /** Routes whose last write failed while they still have edits to save. */
  failedRoutes: number[];
  /** Routes in conflict (409 DRAFT_CONFLICT). */
  conflictRoutes: number[];
};

/** Everything the header, the publish dialog and the map read, in one pass. */
export function summarize(model: DraftModel): DraftSummary {
  const changesByRoute: Record<number, Change[]> = {};
  const issuesByRoute: Record<number, Issue[]> = {};
  let changeCount = 0;
  let errorCount = 0;
  let blockingErrorCount = 0;
  let lastSavedMs = -Infinity;
  let lastSavedAt: string | null = null;
  const draftRouteIds: number[] = [];
  for (const id of model.order) {
    const e = model.routes[id];
    if (!e) continue;
    const d = derive(e, model.packageLevel);
    changesByRoute[id] = d.changes;
    issuesByRoute[id] = d.issues;
    changeCount += d.changes.length;
    const errors = d.issues.filter((i) => i.level === "error").length;
    errorCount += errors;
    if (entryHasDraft(e)) {
      draftRouteIds.push(id);
      blockingErrorCount += errors;
    }
    const ms = e.savedAt ? Date.parse(e.savedAt) : Number.NaN;
    if (Number.isFinite(ms) && ms > lastSavedMs) {
      lastSavedMs = ms;
      lastSavedAt = e.savedAt;
    }
  }
  const all = Object.values(model.routes);
  const hasDraft = draftRouteIds.length > 0;
  return {
    changeCount,
    changesByRoute,
    issuesByRoute,
    errorCount,
    blockingErrorCount,
    hasDraft,
    isNoopDraft: hasDraft && changeCount === 0,
    draftRouteIds,
    lastSavedAt,
    saving: all.some((e) => e.saving),
    unsaved: all.some((e) => e.saving || e.dirty),
    failedRoutes: all.filter((e) => e.error != null && (e.dirty || e.error.op === "delete")).map((e) => e.routeId),
    conflictRoutes: all.filter((e) => e.conflict != null).map((e) => e.routeId),
  };
}

/** The working copy of every route, by id — buildFieldsMap's `configs`. */
export function currentConfigs(model: DraftModel): Record<number, RouteFieldsConfig> {
  const out: Record<number, RouteFieldsConfig> = {};
  for (const e of Object.values(model.routes)) out[e.routeId] = e.current;
  return out;
}
