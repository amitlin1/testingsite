import { ID_PATTERNS } from "@/app/lib/station-fields/schema";
import type { FieldId, GroupTarget, StepUid } from "@/app/lib/station-fields/schema";

/**
 * The view state of /settings/testing-routes, kept in the query string so a link opens exactly
 * what the admin saw (route-fields spec §5.2, D6):
 *
 *   ?type={package_type_id}&route={route_number}&view=map|steps|library|report
 *    [&step={step_uid}&target={box|each_item|item|item:{item_type_id}}]   ← the cell editor (view=map)
 *    [&field={field_id}]                                                    ← "עבור לשדה"
 *    [&item={item_type_id}]                                                 ← view=steps: a line's route
 *    [&lib=sets|lists&id={id}]                                              ← inside view=library
 *
 * Pure: parse and serialise, plus the transitions the page makes. Anything invalid falls back to
 * its default, and the state is always CANONICAL (the invariants below), so the page can compare
 * two states by their serialised form:
 *   - type and route come together, or neither (a route is the pair);
 *   - step and target come together, and only in view=map; field only with them;
 *   - item only in view=steps, and only with a route;
 *   - lib only in view=library (default "sets"); id only with lib.
 * Which step uids and targets the route really has is the map's business: a link to a cell that
 * is gone is the page's to send back to the map (backToMap).
 */

export const ROUTE_VIEWS = ["map", "steps", "library", "report"] as const;
export type RouteView = (typeof ROUTE_VIEWS)[number];

export const LIBRARY_TABS = ["sets", "lists"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];

export interface RouteQuery {
  /** item_type_id of the kit or the item whose route is open. */
  type: number | null;
  /** route_number. */
  route: number | null;
  view: RouteView;
  step: StepUid | null;
  target: GroupTarget | null;
  field: FieldId | null;
  /** view=steps: the kit's template line (its item_type_id) whose route is shown; null = the box. */
  item: number | null;
  lib: LibraryTab | null;
  /** The field set / option list open in the library. */
  id: number | null;
}

/** A route as the screen names it: the pair (item_type_id, route_number). */
export type RouteRef = { type: number; route: number };

export const DEFAULT_ROUTE_QUERY: RouteQuery = Object.freeze({
  type: null, route: null, view: "map", step: null, target: null, field: null, item: null, lib: null, id: null,
});

/** What parseRouteQuery reads: URLSearchParams, Next's ReadonlyURLSearchParams, or a query string. */
export type ParamSource = { get(name: string): string | null } | string;

// ---- values -------------------------------------------------------------------------------------
/** Ids and route numbers are int4 columns (as the API checks them): a larger number names no row. */
const INT4_MAX = 2147483647;

/** A positive int4 written in digits only ("5"; never "05x", "1e3", "-1" or " 5"). */
function readId(raw: string | null): number | null {
  if (raw == null || !/^[0-9]{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= INT4_MAX ? n : null;
}

const isId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= INT4_MAX;

function readView(raw: string | null): RouteView {
  return (ROUTE_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as RouteView) : "map";
}

function readLib(raw: string | null): LibraryTab {
  return (LIBRARY_TABS as readonly string[]).includes(raw ?? "") ? (raw as LibraryTab) : "sets";
}

/** The URL form of a group target: "box" | "each_item" | "item" | "item:{item_type_id}". */
export function encodeTarget(t: GroupTarget): string {
  return typeof t === "string" ? t : "item:" + t.item_type_id;
}

/** encodeTarget's inverse; null for anything else. */
export function parseTargetParam(raw: string | null): GroupTarget | null {
  if (raw === "box" || raw === "each_item" || raw === "item") return raw;
  const m = raw == null ? null : /^item:([0-9]{1,10})$/.exec(raw);
  const id = m ? readId(m[1]) : null;
  return id == null ? null : { item_type_id: id };
}

/** The same target (an item-type target compares by item_type_id). */
export function sameTarget(a: GroupTarget | null, b: GroupTarget | null): boolean {
  if (a == null || b == null) return a === b;
  return encodeTarget(a) === encodeTarget(b);
}

// ---- parse / serialise ----------------------------------------------------------------------------
/** The state as the invariants above have it: whatever does not fit is dropped. */
export function normalizeRouteQuery(q: RouteQuery): RouteQuery {
  const hasRoute = isId(q.type) && isId(q.route);
  const inMap = q.view === "map";
  const step = inMap && q.step != null && ID_PATTERNS.step.test(q.step) ? q.step : null;
  const target = step != null && q.target != null ? parseTargetParam(encodeTarget(q.target)) : null;
  const editor = step != null && target != null;
  const field = editor && q.field != null && ID_PATTERNS.field.test(q.field) ? q.field : null;
  const inLibrary = q.view === "library";
  const inSteps = q.view === "steps";
  return {
    type: hasRoute ? q.type : null,
    route: hasRoute ? q.route : null,
    view: (ROUTE_VIEWS as readonly string[]).includes(q.view) ? q.view : "map",
    step: editor ? step : null,
    target: editor ? target : null,
    field,
    item: hasRoute && inSteps && isId(q.item) ? q.item : null,
    lib: inLibrary ? readLib(q.lib) : null,
    id: inLibrary && isId(q.id) ? q.id : null,
  };
}

/** The query string (or URLSearchParams) as a canonical RouteQuery. */
export function parseRouteQuery(source: ParamSource): RouteQuery {
  const params = typeof source === "string" ? new URLSearchParams(source) : source;
  const get = (k: string) => params.get(k);
  return normalizeRouteQuery({
    type: readId(get("type")),
    route: readId(get("route")),
    view: readView(get("view")),
    step: get("step"),
    target: parseTargetParam(get("target")),
    field: get("field"),
    item: readId(get("item")),
    lib: get("lib") as LibraryTab | null,
    id: readId(get("id")),
  });
}

/** The canonical query string, without "?": type, route, view (always written), step, target,
 *  field, item, lib, id — only the members the state holds. */
export function serializeRouteQuery(q: RouteQuery): string {
  const n = normalizeRouteQuery(q);
  const out = new URLSearchParams();
  if (n.type != null && n.route != null) {
    out.set("type", String(n.type));
    out.set("route", String(n.route));
  }
  out.set("view", n.view);
  if (n.step != null && n.target != null) {
    out.set("step", n.step);
    out.set("target", encodeTarget(n.target));
    if (n.field != null) out.set("field", n.field);
  }
  if (n.item != null) out.set("item", String(n.item));
  if (n.lib != null) {
    out.set("lib", n.lib);
    if (n.id != null) out.set("id", String(n.id));
  }
  return out.toString();
}

/** pathname + "?" + the query (router.replace / router.push / a Link href). */
export function routeQueryHref(pathname: string, q: RouteQuery): string {
  return pathname + "?" + serializeRouteQuery(q);
}

/** Two states that serialise alike — the page's guard before replacing the URL. */
export function sameRouteQuery(a: RouteQuery, b: RouteQuery): boolean {
  return serializeRouteQuery(a) === serializeRouteQuery(b);
}

// ---- transitions -----------------------------------------------------------------------------------
/** The route the state names, or null. */
export function routeRefOf(q: RouteQuery): RouteRef | null {
  return q.type != null && q.route != null ? { type: q.type, route: q.route } : null;
}

/** The cell editor is open (view=map with step and target). */
export function isEditorOpen(q: RouteQuery): boolean {
  return q.view === "map" && q.step != null && q.target != null;
}

/** "חזרה למפה": the map, without step / target / field (spec §5.2). */
export function backToMap(q: RouteQuery): RouteQuery {
  return normalizeRouteQuery({ ...q, view: "map", step: null, target: null, field: null });
}

/** Another route in the context card's pickers. Step uids belong to a route, so the editor closes,
 *  and another kit has other lines, so "שלבי המסלול" goes back to the box; the view stays (the
 *  library is the same for every route). null clears the route. */
export function withRoute(q: RouteQuery, ref: RouteRef | null): RouteQuery {
  const same = ref != null && ref.type === q.type && ref.route === q.route;
  return normalizeRouteQuery({
    ...q, type: ref?.type ?? null, route: ref?.route ?? null, step: null, target: null, field: null, item: same ? q.item : null,
  });
}

/** Another tab. The map tab opens on the map (not on a cell editor left behind); the library opens
 *  on "sets" unless it is already open. */
export function withView(q: RouteQuery, view: RouteView): RouteQuery {
  if (view === q.view && view !== "map") return normalizeRouteQuery(q);
  return normalizeRouteQuery({ ...q, view, step: null, target: null, field: null, item: null, lib: view === "library" ? q.lib : null, id: view === "library" ? q.id : null });
}

/** "שלבי המסלול" on a template line's route (its item_type_id), or on the box (null). */
export function withItem(q: RouteQuery, item: number | null): RouteQuery {
  return normalizeRouteQuery({ ...q, view: "steps", step: null, target: null, field: null, item, lib: null, id: null });
}

/** The cell editor on (step, target), optionally focused on a field ("עבור לשדה"). */
export function withEditor(q: RouteQuery, step: StepUid, target: GroupTarget, field: FieldId | null = null): RouteQuery {
  return normalizeRouteQuery({ ...q, view: "map", step, target, field, lib: null, id: null });
}

/** Focus a field of the open editor, or none. */
export function withField(q: RouteQuery, field: FieldId | null): RouteQuery {
  return normalizeRouteQuery({ ...q, field });
}

/** The library on a tab, optionally with a set / list open. */
export function withLibrary(q: RouteQuery, lib: LibraryTab, id: number | null = null): RouteQuery {
  return normalizeRouteQuery({ ...q, view: "library", step: null, target: null, field: null, lib, id });
}

// ---- the last route (localStorage) ----------------------------------------------------------------
/** One key, like the dashboard's "sh.dashboard.railOpen". */
export const LAST_ROUTE_STORAGE_KEY = "sh.testingRoutes.lastRoute";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** window.localStorage, or null where reading it throws (private mode, blocked site data, SSR). */
function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The route last opened in this browser, or null (nothing stored, unreadable, or not a route). */
export function readLastRoute(storage: StorageLike | null = defaultStorage()): RouteRef | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { type, route } = v as Record<string, unknown>;
    return isId(type) && isId(route) ? { type, route } : null;
  } catch {
    return null;
  }
}

/** Remember the open route. Best effort: a storage that refuses (quota, privacy mode) is ignored. */
export function writeLastRoute(ref: RouteRef, storage: StorageLike | null = defaultStorage()): void {
  if (!storage || !isId(ref.type) || !isId(ref.route)) return;
  try {
    storage.setItem(LAST_ROUTE_STORAGE_KEY, JSON.stringify({ type: ref.type, route: ref.route }));
  } catch {
    /* storage unavailable — the URL still carries the route */
  }
}

/** Spec §5.2: without `type`, the route last opened. A state that names a route keeps it. */
export function withLastRoute(q: RouteQuery, last: RouteRef | null): RouteQuery {
  return routeRefOf(q) || !last ? q : normalizeRouteQuery({ ...q, type: last.type, route: last.route });
}
