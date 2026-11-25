import { isInt, isRecord } from "@/lib/json-guards";
import { isDbId } from "@/lib/http/request";
import type { Change } from "@/app/lib/station-fields/diff";
import type { GroupTarget, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { ShapeError, parseFieldList, parseOptionList as parseOptions, parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import type {
  ContextLineJson, DraftSavedJson, FieldSetJson, FieldsContextJson, ForkResultJson, LibraryUseJson, OptionListJson,
  OptionListSavedJson, PublishImpactJson, PublishImpactRouteJson, PublishResultJson, RouteFieldsJson, SharedKitJson,
  StationTypeJson,
} from "@/app/lib/station-fields/admin-types";
import type { RouteListRow } from "@/app/lib/station-fields/admin-types";
import type { PackageRole } from "@/app/lib/popup-templates/schema";

/**
 * The screen's side of the settings API: every URL it calls, and every answer checked against the
 * contract (admin-types.ts) before the screen builds on it — configs and field lists through the
 * server's own structural parse (a sanitized copy). A parser throws BadBody on anything else.
 */

// ---- URLs -------------------------------------------------------------------------------------------
const ROUTES = "/api/settings/testing-routes";
const OPTION_LISTS = "/api/settings/option-lists";
const FIELD_SETS = "/api/settings/field-sets";

export const API = {
  routes: ROUTES,
  /** The route of (item type, route number), as a list of at most one. */
  routeOf: (itemTypeId: number, routeNumber: number) => `${ROUTES}?itemTypeId=${itemTypeId}&routeNumber=${routeNumber}`,
  route: (routeId: number) => `${ROUTES}/${routeId}`,
  routeFields: (routeId: number) => `${ROUTES}/${routeId}/fields`,
  routeDraft: (routeId: number) => `${ROUTES}/${routeId}/fields/draft`,
  fork: (routeId: number) => `${ROUTES}/${routeId}/fork`,
  fieldsContext: (packageTypeId: number, routeNumber: number) =>
    `${ROUTES}/fields-context?${new URLSearchParams({ packageTypeId: String(packageTypeId), routeNumber: String(routeNumber) })}`,
  publishPreview: `${ROUTES}/fields/publish-preview`,
  publish: `${ROUTES}/fields/publish`,
  optionLists: OPTION_LISTS,
  optionList: (id: number) => `${OPTION_LISTS}/${id}`,
  optionListPropagate: (id: number) => `${OPTION_LISTS}/${id}/propagate`,
  fieldSets: FIELD_SETS,
  fieldSet: (id: number) => `${FIELD_SETS}/${id}`,
  fieldSetPropagate: (id: number) => `${FIELD_SETS}/${id}/propagate`,
  fieldSetUsage: (id: number) => `${FIELD_SETS}/${id}/usage`,
  itemTypes: "/api/settings/item-types",
  stationTypes: "/api/settings/test-stations-type",
  popupTemplates: "/api/settings/popup-templates",
} as const;

// ---- primitives -------------------------------------------------------------------------------------
/** An answer that is not what the contract says. */
export class BadBody extends Error {}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** The `code` of an error answer ({ error, code, … }), or null. */
export function errorCode(body: unknown): string | null {
  return isRecord(body) && typeof body.code === "string" ? body.code : null;
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new BadBody(what);
}

/** A parse of the server's own (ShapeError → BadBody). */
function shaped<T>(read: () => T, what: string): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof ShapeError) throw new BadBody(what + ": " + e.message);
    throw e;
  }
}

const configOf = (v: unknown, what: string): RouteFieldsConfig | null => (v == null ? null : shaped(() => parseRouteFieldsConfig(v), what));

function listOf<T>(v: unknown, what: string, item: (x: unknown) => T): T[] {
  check(Array.isArray(v), what);
  return (v as unknown[]).map(item);
}

/** An optional string member: absent / null → undefined. */
function optionalStr(v: unknown, what: string): string | undefined {
  if (v == null) return undefined;
  check(typeof v === "string", what);
  return v as string;
}

const targetOf = (v: unknown): GroupTarget | null =>
  v === "item" || v === "box" || v === "each_item" ? v : isRecord(v) && isDbId(v.item_type_id) ? { item_type_id: v.item_type_id } : null;

// ---- routes and the fields context --------------------------------------------------------------------
function issuesOf(v: unknown): Issue[] {
  return listOf(v, "issues", (i) => {
    check(isRecord(i) && (i.level === "error" || i.level === "warning") && typeof i.code === "string" && typeof i.message === "string", "issue");
    return i as Issue;
  });
}

function kitsOf(v: unknown): SharedKitJson[] {
  return listOf(v, "shared_with", (k) => {
    check(isRecord(k) && isDbId(k.package_type_id) && typeof k.desc === "string", "shared_with");
    const kit = k as { package_type_id: number; desc: string };
    return { package_type_id: kit.package_type_id, desc: kit.desc };
  });
}

/** GET …/[id]/fields — one route (and one route of the fields context). */
export function parseRouteFields(v: unknown): RouteFieldsJson {
  check(isRecord(v) && isRecord(v.route), "route");
  const o = v as Record<string, unknown>;
  const r = o.route as Record<string, unknown>;
  check(isDbId(r.test_route_id) && isDbId(r.item_type_id) && isInt(r.route_number), "route ids");
  check(Array.isArray(r.route_steps) && r.route_steps.every(isInt), "route_steps");
  check(Array.isArray(r.step_uids) && r.step_uids.every((u) => typeof u === "string"), "step_uids");
  check(isCount(o.draft_rev) && isCount(o.published_version), "revs");
  check(isStrOrNull(o.draft_updated_at) && isStrOrNull(o.draft_updated_by), "draft_updated");
  return {
    route: {
      test_route_id: r.test_route_id as number,
      item_type_id: r.item_type_id as number,
      route_number: r.route_number as number,
      route_steps: r.route_steps as number[],
      step_uids: r.step_uids as string[],
    },
    draft: configOf(o.draft, "draft"),
    draft_rev: o.draft_rev as number,
    draft_updated_at: o.draft_updated_at as string | null,
    draft_updated_by: o.draft_updated_by as string | null,
    published_version: o.published_version as number,
    published: configOf(o.published, "published"),
    issues: issuesOf(o.issues),
    shared_with: kitsOf(o.shared_with),
  };
}

function lineOf(v: unknown): ContextLineJson {
  check(isRecord(v), "line");
  const o = v as Record<string, unknown>;
  const ints = [o.line_id, o.item_type_id, o.quantity, o.sort_order, o.seq_from, o.seq_to, o.route_number];
  check(ints.every(isInt) && typeof o.item_type_desc === "string", "line");
  const line: ContextLineJson = {
    line_id: o.line_id as number,
    item_type_id: o.item_type_id as number,
    item_type_desc: o.item_type_desc as string,
    quantity: o.quantity as number,
    sort_order: o.sort_order as number,
    seq_from: o.seq_from as number,
    seq_to: o.seq_to as number,
    route_number: o.route_number as number,
    route: o.route == null ? null : parseRouteFields(o.route),
  };
  const missing = optionalStr(o.missing, "line.missing");
  if (missing !== undefined) line.missing = missing;
  return line;
}

/** GET …/fields-context of a kit (packageTypeId): the screen asks for kits only. */
export function parseFieldsContext(v: unknown): FieldsContextJson {
  check(isRecord(v) && v.kind === "package", "kind");
  const o = v as Record<string, unknown>;
  const s = o.subject;
  check(isRecord(s) && isDbId(s.item_type_id) && typeof s.desc === "string" && typeof s.is_package === "boolean" && isInt(s.route_number), "subject");
  const subject = s as FieldsContextJson["subject"];
  check(isRecord(o.stations), "stations");
  const stations: Record<number, StationTypeJson> = {};
  for (const [k, st] of Object.entries(o.stations as Record<string, unknown>)) {
    check(/^[0-9]{1,10}$/.test(k) && isRecord(st) && typeof st.label === "string" && typeof st.package_level === "boolean", "station");
    const station = st as StationTypeJson;
    stations[Number(k)] = { label: station.label, package_level: station.package_level };
  }
  const kitMissing = optionalStr(o.kit_missing, "kit_missing");
  optionalStr(o.item_missing, "item_missing");
  const out: FieldsContextJson = {
    kind: "package",
    subject: { item_type_id: subject.item_type_id, desc: subject.desc, is_package: subject.is_package, route_number: subject.route_number },
    stations,
    kit: o.kit == null ? null : parseRouteFields(o.kit),
    item: null,
    lines: listOf(o.lines, "lines", lineOf),
  };
  if (kitMissing !== undefined) out.kit_missing = kitMissing;
  return out;
}

/** A row of GET /api/settings/testing-routes (and of its POST / PUT answers): the members this screen
 *  reads. */
export type RouteRowJson = Pick<RouteListRow, "test_route_id" | "item_type_id" | "route_number" | "route_steps" | "step_uids">;

export function parseRouteRow(v: unknown): RouteRowJson {
  check(isRecord(v) && isDbId(v.test_route_id) && isDbId(v.item_type_id) && isDbId(v.route_number), "route row");
  const o = v as Record<string, unknown>;
  check(Array.isArray(o.route_steps) && o.route_steps.every(isInt), "route row steps");
  // A route a script inserted may have no uids at all.
  const uids = o.step_uids == null ? [] : o.step_uids;
  check(Array.isArray(uids) && uids.every((u) => typeof u === "string" || u == null), "route row uids");
  return {
    test_route_id: o.test_route_id as number,
    item_type_id: o.item_type_id as number,
    route_number: o.route_number as number,
    route_steps: o.route_steps as number[],
    step_uids: (uids as (string | null)[]).map((u) => u ?? ""),
  };
}

export const parseRouteRows = (v: unknown): RouteRowJson[] => listOf(v, "routes", parseRouteRow);

// ---- draft writes -----------------------------------------------------------------------------------
/** PUT …/fields/draft → 200. */
export function parseDraftSaved(v: unknown): DraftSavedJson {
  check(isRecord(v) && isCount(v.draft_rev) && typeof v.draft_updated_at === "string", "draft saved");
  const o = v as Record<string, unknown>;
  return { draft_rev: o.draft_rev as number, draft_updated_at: o.draft_updated_at as string, issues: issuesOf(o.issues) };
}

/** DELETE …/fields/draft → 200 { draft_rev }. */
export function parseDraftDeleted(v: unknown): number {
  check(isRecord(v) && isCount(v.draft_rev), "draft deleted");
  return (v as { draft_rev: number }).draft_rev;
}

/** 409 DRAFT_CONFLICT: what the server holds now (admin.ts). */
export type DraftConflictJson = { draft: RouteFieldsConfig | null; draft_rev: number; draft_updated_at: string | null; draft_updated_by: string | null };

export function parseDraftConflict(v: unknown): DraftConflictJson {
  check(errorCode(v) === "DRAFT_CONFLICT" && isRecord(v) && isCount(v.draft_rev), "draft conflict");
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : null);
  return { draft: configOf(o.draft, "conflict draft"), draft_rev: o.draft_rev as number, draft_updated_at: str(o.draft_updated_at), draft_updated_by: str(o.draft_updated_by) };
}

// ---- publish ----------------------------------------------------------------------------------------
function isChange(v: unknown): v is Change {
  return isRecord(v) && typeof v.step_uid === "string" && typeof v.kind === "string" && typeof v.label === "string"
    && targetOf(v.target) != null && (v.field_id === undefined || typeof v.field_id === "string")
    && (v.detail === undefined || isRecord(v.detail)) && (v.filled_count === undefined || isCount(v.filled_count));
}

function isImpactRoute(v: unknown): v is PublishImpactRouteJson {
  return isRecord(v) && isDbId(v.route_id) && typeof v.label === "string" && isDbId(v.item_type_id)
    && typeof v.item_type_desc === "string" && isDbId(v.route_number) && isCount(v.from_version)
    && isCount(v.to_version) && Array.isArray(v.changes) && v.changes.every(isChange);
}

/** POST …/fields/publish-preview → 200. */
export function parsePublishImpact(v: unknown): PublishImpactJson {
  check(isRecord(v) && Array.isArray(v.routes) && v.routes.every(isImpactRoute), "impact routes");
  const o = v as Record<string, unknown>;
  const t = o.totals;
  check(isRecord(t) && isCount(t.changes) && isCount(t.stations) && isCount(t.routes), "impact totals");
  check(Array.isArray(o.shared_outside) && o.shared_outside.every((s) => isRecord(s) && isDbId(s.route_id)
    && typeof s.item_type_desc === "string" && isDbId(s.route_number) && Array.isArray(s.kits)
    && s.kits.every((k) => isRecord(k) && isDbId(k.package_type_id) && typeof k.desc === "string")), "impact shared_outside");
  check(isCount(o.items_on_routes) && isCount(o.not_started) && isCount(o.not_reached) && Array.isArray(o.by_version) && Array.isArray(o.issues), "impact counts");
  check(isRecord(o.base_revs) && Object.values(o.base_revs).every(isCount), "impact base_revs");
  return v as unknown as PublishImpactJson;
}

/** POST …/fields/publish → 200. */
export function parsePublishResult(v: unknown): PublishResultJson {
  check(isRecord(v) && typeof v.publish_batch === "string" && isRecord(v.versions) && isCount(v.bumped_items), "publish result");
  check(Object.values((v as { versions: Record<string, unknown> }).versions).every(isCount), "publish versions");
  return v as unknown as PublishResultJson;
}

// ---- the library ------------------------------------------------------------------------------------
export function parseOptionList(v: unknown): OptionListJson {
  check(isRecord(v) && isDbId(v.id) && typeof v.name === "string" && isDbId(v.version) && typeof v.updated_at === "string" && isStrOrNull(v.updated_by), "option list");
  const o = v as Record<string, unknown>;
  const u = o.usage;
  check(isRecord(u) && isCount(u.fields) && isCount(u.routes), "option list usage");
  const usage = u as OptionListJson["usage"];
  return {
    id: o.id as number,
    name: o.name as string,
    options: shaped(() => parseOptions(o.options), "option list options"),
    version: o.version as number,
    updated_at: o.updated_at as string,
    updated_by: o.updated_by as string | null,
    usage: { fields: usage.fields, routes: usage.routes },
  };
}

export function parseFieldSet(v: unknown): FieldSetJson {
  check(isRecord(v) && isDbId(v.id) && typeof v.name === "string" && isDbId(v.version)
    && typeof v.created_at === "string" && typeof v.updated_at === "string" && isStrOrNull(v.updated_by), "field set");
  const o = v as Record<string, unknown>;
  const u = o.usage;
  check(isRecord(u) && isCount(u.cells) && isCount(u.outdated), "field set usage");
  const usage = u as FieldSetJson["usage"];
  return {
    id: o.id as number,
    name: o.name as string,
    fields: shaped(() => parseFieldList(o.fields), "field set fields"),
    version: o.version as number,
    created_at: o.created_at as string,
    updated_at: o.updated_at as string,
    updated_by: o.updated_by as string | null,
    usage: { cells: usage.cells, outdated: usage.outdated },
  };
}

export const parseOptionLists = (v: unknown): OptionListJson[] => listOf(v, "option lists", parseOptionList);
export const parseFieldSets = (v: unknown): FieldSetJson[] => listOf(v, "field sets", parseFieldSet);

/** GET …/field-sets/[id]/usage. */
export function parseLibraryUses(v: unknown): LibraryUseJson[] {
  return listOf(v, "usage", (u) => {
    const target = isRecord(u) ? targetOf(u.target) : null;
    check(isRecord(u) && target != null && isDbId(u.route_id) && typeof u.step_uid === "string" && typeof u.field_id === "string"
      && isCount(u.ver) && (u.in === "draft" || u.in === "published") && isStrOrNull(u.kit_desc)
      && typeof u.station_label === "string" && typeof u.item_label === "string", "usage row");
    const o = u as LibraryUseJson;
    return {
      route_id: o.route_id, step_uid: o.step_uid, target: target as GroupTarget, field_id: o.field_id, ver: o.ver, in: o.in,
      kit_desc: o.kit_desc, station_label: o.station_label, item_label: o.item_label,
    };
  });
}

/** PUT …/field-sets/[id] → { version }. */
export function parseVersion(v: unknown): number {
  check(isRecord(v) && isDbId(v.version), "version");
  return (v as { version: number }).version;
}

/** PUT …/option-lists/[id] → { version, linked }. */
export function parseOptionListSaved(v: unknown): OptionListSavedJson {
  const version = parseVersion(v);
  const linked = listOf((v as Record<string, unknown>).linked, "linked", (l) => {
    check(isRecord(l) && isDbId(l.route_id) && typeof l.step_uid === "string" && typeof l.field_id === "string", "linked row");
    const o = l as OptionListSavedJson["linked"][number];
    return { route_id: o.route_id, step_uid: o.step_uid, field_id: o.field_id };
  });
  return { version, linked };
}

/** POST …/propagate → { updated_drafts }. */
export function parsePropagated(v: unknown): number {
  check(isRecord(v) && isCount(v.updated_drafts), "propagate");
  return (v as { updated_drafts: number }).updated_drafts;
}

// ---- fork -------------------------------------------------------------------------------------------
export function parseForkResult(v: unknown): ForkResultJson {
  check(isRecord(v) && isDbId(v.test_route_id) && isDbId(v.route_number), "fork");
  const o = v as ForkResultJson;
  return { test_route_id: o.test_route_id, route_number: o.route_number };
}

// ---- other screens' lists ---------------------------------------------------------------------------
/** A station type with a popup template: its base and — a package template — its role. */
export type TemplateInfo = { base: string; role: PackageRole | null };

/** GET /api/settings/popup-templates, by station type. */
export function parseTemplateTypes(v: unknown): ReadonlyMap<number, TemplateInfo> {
  const rows = listOf(v, "popup templates", (r) => {
    check(isRecord(r) && isDbId(r.station_type_id) && typeof r.base === "string", "popup template");
    const o = r as { station_type_id: number; base: string; role?: PackageRole | null };
    return [o.station_type_id, { base: o.base, role: o.role ?? null }] as const;
  });
  return new Map(rows);
}

