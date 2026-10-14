import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { TransactionClient } from "@/app/lib/prisma";
import { AdminFieldsError } from "./admin";
import type { Actor } from "./admin";
import type { FieldSetSavedJson, LibraryUseJson, OptionListSavedJson, PropagateResultJson } from "./admin-types";
import { ID_PATTERNS, targetKey } from "./schema";
import type { ChoiceOption, Field, GroupTarget, InputField, RouteFieldsConfig, StepConfig, StepUid, VersionRef } from "./schema";
import { newFieldId } from "./step-uids";
import { ShapeError, parseFieldList, parseOptionList, parseRouteFieldsConfig } from "./validate";

/**
 * Station fields — the libraries (route-fields spec §3.2 option-lists / field-sets rows, §5.7
 * "החל על השדה", §5.9 "שמירה כגרסה"; artboards 4 and 8): shared option lists, whose options a
 * choice field copies and links with list_ref {id, ver}, and field sets, whose fields a cell copies
 * and links with from_set {id, ver}. Saving a row makes a new version; the linked places keep the
 * version they copied until propagate offers them the new one.
 *
 * SERVER ONLY (prisma). The handlers under /api/settings/option-lists and /api/settings/field-sets
 * are thin, as admin.ts's are: path, body, actor, and adminFieldsErrorResponse. The views are the
 * wire shapes of admin-types.ts before JSON (Dates where the wire has ISO strings).
 *
 * Usage is computed at read time (spec §3.2 "ספירת שימוש"), over every route's fields_draft AND its
 * latest published version. A place is, for an option list, a linked field (route, step uid, field
 * id); for a field set, a cell (route, step uid, group target) holding fields taken from it. A
 * place counts once per route, from the draft when both configs hold it.
 *
 * Propagate rewrites DRAFTS only: each route starts from its fields_draft, or its latest published
 * config when it has no draft, and the result is saved as the draft (draft_rev + 1). A published
 * version is never touched — every change still goes out through publish.
 *
 * Error contract — AdminFieldsError, answered as { error: message, code, ...extra }:
 *   400 INVALID_ID · INVALID_BODY (not an object, base_version, targets) · NAME_INVALID (name not a
 *       non-blank string of at most 100 characters once trimmed) · SHAPE_INVALID {path} (options /
 *       fields, validate.ts)
 *   404 OPTION_LIST_NOT_FOUND / FIELD_SET_NOT_FOUND {id} — an archived row too: archived = deleted
 *   409 VERSION_CONFLICT {current} — PUT whose base_version is not the row's version; `current` is
 *       the row exactly as the GET list gives it, so the editor can reload
 *   409 IN_USE {usage, field_sets?} — DELETE of a row still used in a draft or a published version
 *       (an option list also while a field set's field links to it)
 *   422 PROPAGATE_INVALID {route_id, path} — a propagated draft would break the config limits
 *       (e.g. more fields in a cell than a group holds); nothing is written
 *   500 CONFIG_INVALID {route_id} / VERSION_MISSING {route_id} — a route config that cannot be read;
 *       LIST_INVALID / SET_INVALID {id} — a stored row that does not parse. Never an empty answer.
 *
 * Locks: PUT and DELETE lock the library row (FOR UPDATE). Propagate holds it FOR SHARE, so the
 * version it copies is still the row's version at commit, then locks each route it rewrites, one by
 * one in ascending id — the one order every multi-route write takes (admin.ts).
 */

// ---- types ----------------------------------------------------------------------------------
/** Any handle that can read: the client or a transaction. */
type Db = TransactionClient;

export type LibraryKind = "list" | "set";

/** GET /api/settings/option-lists — one row (OptionListJson before JSON). */
export type OptionListView = {
  id: number;
  name: string;
  options: ChoiceOption[];
  version: number;
  updated_at: Date;
  updated_by: string | null;
  /** "בשימוש ב-{fields} שדות[ ב-{routes} מסלולים]". */
  usage: { fields: number; routes: number };
};

/** GET /api/settings/field-sets — one row (FieldSetJson before JSON). */
export type FieldSetView = {
  id: number;
  name: string;
  fields: Field[];
  version: number;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
  /** "בשימוש ב-{cells} תאים"; outdated = cells holding an older version. */
  usage: { cells: number; outdated: number };
};

/** One place a library row is used (GET …/[id]/usage). */
export type LibraryUse = LibraryUseJson;

/** A linked field: what PUT option-lists answers as `linked`, and what propagate's targets name.
 *  For a field set, the target's field_id picks the cell (step group) holding that field. */
export type LinkTarget = { route_id: number; step_uid: StepUid; field_id: string };

/** Bodies as they arrive; every member is checked here (400 when wrong). */
export type OptionListInput = { name?: unknown; options?: unknown; base_version?: unknown };
export type FieldSetInput = { name?: unknown; fields?: unknown; base_version?: unknown };
export type PropagateInput = { targets?: unknown };

/** option_lists.name / field_sets.name are VARCHAR(100). */
export const LIBRARY_NAME_MAX = 100;

/** More targets than any library is linked to — a guard on the size of one request. */
const MAX_TARGETS = 1000;

/** The same bounds as admin.ts's transactions: propagate may wait on a publish holding a route. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;
/** Reads: the rows and the routes they are counted over from one snapshot. */
const READ_TX = { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } as const;

/** Artboard 8's usage chips name the row of a package-level cell as the fields map does
 *  (artboard 1): "… › הקופסה", "… › כל פריט במארז". */
const BOX_ROW_LABEL = "הקופסה";
const EACH_ITEM_ROW_LABEL = "כל פריט במארז";

/** jsonb_path_exists filters (spec §3.2): a route config's fields linked to the row `$id`, and (for
 *  an option list's DELETE) a field set's fields linked to it. */
const LINK_PATHS: Record<LibraryKind, string> = {
  list: "$.steps.*.groups[*].fields[*] ? (@.list_ref.id == $id)",
  set: "$.steps.*.groups[*].fields[*] ? (@.from_set.id == $id)",
};
const SET_FIELDS_LIST_PATH = "$[*] ? (@.list_ref.id == $id)";

const KIND: Record<LibraryKind, { what: string; notFound: string; invalid: string }> = {
  list: { what: "Option list", notFound: "OPTION_LIST_NOT_FOUND", invalid: "LIST_INVALID" },
  set: { what: "Field set", notFound: "FIELD_SET_NOT_FOUND", invalid: "SET_INVALID" },
};

// ---- request helpers ----------------------------------------------------------------------------
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Ids and versions are int4 columns: a larger number can name no row, and Postgres would refuse
 *  it as a parameter (a 500) rather than find nothing. */
const INT4_MAX = 2147483647;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= INT4_MAX;

function badBody(message: string): AdminFieldsError {
  return new AdminFieldsError(400, "INVALID_BODY", message);
}

function requireId(v: number, kind: LibraryKind): void {
  if (!isId(v)) throw new AdminFieldsError(400, "INVALID_ID", `${KIND[kind].what} id must be a positive integer`);
}

function notFound(kind: LibraryKind, id: number): AdminFieldsError {
  return new AdminFieldsError(404, KIND[kind].notFound, `${KIND[kind].what} ${id} not found`, { id });
}

/** "שם הרשימה" / the set's name: stored trimmed. */
function nameOf(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.length > LIBRARY_NAME_MAX) {
    throw new AdminFieldsError(400, "NAME_INVALID", `name must be a non-blank string of at most ${LIBRARY_NAME_MAX} characters`);
  }
  return name;
}

/** A structural parse of the body (validate.ts): its ShapeError is a 400 with the path. */
function shapeOf<T>(parse: () => T): T {
  try {
    return parse();
  } catch (e) {
    if (e instanceof ShapeError) throw new AdminFieldsError(400, e.code, e.message, { path: e.path });
    throw e;
  }
}

function optionsOf(raw: unknown): ChoiceOption[] {
  return shapeOf(() => parseOptionList(raw, "$.options"));
}

/** A set's fields as stored: the same checks as a cell's (ids unique in the list), minus any
 *  from_set — a template is not linked to a template; a cell's link is added when it copies. */
function setFieldsOf(raw: unknown): Field[] {
  return shapeOf(() => parseFieldList(raw, "$.fields")).map((f) => {
    if (f.type === "section" || !f.from_set) return f;
    const copy = { ...f };
    delete copy.from_set;
    return copy;
  });
}

function baseVersionOf(raw: unknown): number {
  if (!isId(raw)) throw badBody("base_version must be the version the edit started from");
  return raw;
}

/** targets: absent / null = every linked place; otherwise the places to update. */
function targetsOf(raw: unknown): LinkTarget[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > MAX_TARGETS) {
    throw badBody(`targets must be an array of at most ${MAX_TARGETS} {route_id, step_uid, field_id}`);
  }
  return raw.map((t: unknown, i) => {
    const ok = isRecord(t)
      && isId(t.route_id)
      && typeof t.step_uid === "string" && ID_PATTERNS.step.test(t.step_uid)
      && typeof t.field_id === "string" && ID_PATTERNS.field.test(t.field_id);
    if (!ok) throw badBody(`targets[${i}] must be {route_id, step_uid, field_id}`);
    return { route_id: t.route_id as number, step_uid: t.step_uid as string, field_id: t.field_id as string };
  });
}

// ---- library rows -------------------------------------------------------------------------------
/** option_lists / field_sets, with `payload` = options / fields as stored. */
type LibRow = {
  id: number;
  name: string;
  payload: unknown;
  version: number;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
};

/** One non-archived row, optionally locked; a missing or archived row is a 404. */
async function loadRow(db: Db, kind: LibraryKind, id: number, lock: "update" | "share" | null): Promise<LibRow> {
  const table = kind === "list" ? Prisma.sql`option_lists` : Prisma.sql`field_sets`;
  const payload = kind === "list" ? Prisma.sql`options` : Prisma.sql`fields`;
  const lockSql = lock === "update" ? Prisma.sql`FOR UPDATE` : lock === "share" ? Prisma.sql`FOR SHARE` : Prisma.empty;
  const rows = await db.$queryRaw<(LibRow & { archived: boolean })[]>`
    SELECT id, name, ${payload} AS payload, version, archived, created_at, updated_at, updated_by
      FROM ${table}
     WHERE id = ${id}
     ${lockSql}`;
  const row = rows[0];
  if (!row || row.archived) throw notFound(kind, id);
  return row;
}

/** A stored row was saved parsed, so a failure here is corrupt data: a real 500. */
function storedPayload<T>(kind: LibraryKind, row: LibRow, parse: (raw: unknown) => T): T {
  try {
    return parse(row.payload);
  } catch (e) {
    if (e instanceof ShapeError) {
      throw new AdminFieldsError(500, KIND[kind].invalid, `${KIND[kind].what} ${row.id}: the stored row does not parse (${e.message})`, { id: row.id });
    }
    throw e;
  }
}
const storedOptions = (row: LibRow) => storedPayload("list", row, (raw) => parseOptionList(raw));
const storedSetFields = (row: LibRow) => storedPayload("set", row, (raw) => parseFieldList(raw));

// ---- routes and the places that use a row ---------------------------------------------------------
type RouteRow = {
  test_route_id: number;
  item_type_id: number;
  item_type_desc: string;
  is_package: boolean;
  route_steps: number[];
  /** Parallel to route_steps; a different length means the route has no usable positions. */
  step_uids: string[];
  fields_draft: unknown;
  fields_version: number;
  /** The config of fields_version (null when 0, or when the version row is missing). */
  published_config: unknown;
  has_version: boolean;
};

type RouteConfigs = { route: RouteRow; draft: RouteFieldsConfig | null; published: RouteFieldsConfig | null };

const ROUTE_SELECT = Prisma.sql`
  SELECT tr.test_route_id, tr.item_type_id, TRIM(t.item_type_desc) AS item_type_desc, t.is_package,
         COALESCE(tr.route_steps, '{}') AS route_steps,
         COALESCE(tr.step_uids, '{}') AS step_uids,
         tr.fields_draft, tr.fields_version,
         v.config AS published_config, (v.id IS NOT NULL) AS has_version
    FROM testing_routes tr
    JOIN item_types t ON t.item_type_id = tr.item_type_id
    LEFT JOIN route_field_versions v ON v.test_route_id = tr.test_route_id AND v.version = tr.fields_version`;

/** A route config read back from the database: it was stored parsed, so a failure is a real 500,
 *  never "not used". */
function storedConfig(raw: unknown, routeId: number, what: string): RouteFieldsConfig {
  try {
    return parseRouteFieldsConfig(raw);
  } catch (e) {
    if (e instanceof ShapeError) {
      throw new AdminFieldsError(500, "CONFIG_INVALID", `Route ${routeId}: the stored ${what} does not parse (${e.message})`, { route_id: routeId });
    }
    throw e;
  }
}

function readConfigs(route: RouteRow): RouteConfigs {
  const id = route.test_route_id;
  if (route.fields_version > 0 && !route.has_version) {
    throw new AdminFieldsError(500, "VERSION_MISSING", `Route ${id} points at version ${route.fields_version}, which does not exist`, { route_id: id });
  }
  return {
    route,
    draft: route.fields_draft == null ? null : storedConfig(route.fields_draft, id, "draft"),
    published: route.fields_version > 0 ? storedConfig(route.published_config, id, `version ${route.fields_version}`) : null,
  };
}

/** jsonb_path_exists(column, the kind's path, {id}) — silent, so a malformed config is "no match"
 *  here rather than an error (the full list read still parses every config). */
function linkedIn(column: Prisma.Sql, kind: LibraryKind, id: number): Prisma.Sql {
  return Prisma.sql`COALESCE(jsonb_path_exists(${column}, ${LINK_PATHS[kind]}::jsonpath, jsonb_build_object('id', ${id}::int), true), false)`;
}

/**
 * Every route that has a draft or a published version, ascending id. With `linkedTo`, only the
 * routes whose draft or latest published config links to that row — the per-row reads parse no
 * more than they need.
 */
async function loadRouteConfigs(db: Db, linkedTo: { kind: LibraryKind; id: number } | null): Promise<RouteConfigs[]> {
  const filter = linkedTo
    ? Prisma.sql`AND (${linkedIn(Prisma.sql`tr.fields_draft`, linkedTo.kind, linkedTo.id)} OR ${linkedIn(Prisma.sql`v.config`, linkedTo.kind, linkedTo.id)})`
    : Prisma.empty;
  const rows = await db.$queryRaw<RouteRow[]>`${ROUTE_SELECT}
     WHERE (tr.fields_draft IS NOT NULL OR tr.fields_version > 0)
     ${filter}
     ORDER BY tr.test_route_id`;
  return rows.map(readConfigs);
}

/** One route, locked (FOR UPDATE of the testing_routes row only), read after the lock. */
async function lockRouteConfigs(tx: Db, routeId: number): Promise<RouteConfigs | null> {
  const rows = await tx.$queryRaw<RouteRow[]>`${ROUTE_SELECT}
     WHERE tr.test_route_id = ${routeId}
     FOR UPDATE OF tr`;
  return rows[0] ? readConfigs(rows[0]) : null;
}

const fromSetOf = (f: Field): VersionRef | undefined => (f.type === "section" ? undefined : f.from_set);
const listRefOf = (f: Field): VersionRef | undefined =>
  (f.type === "choice_row" || f.type === "multi_choice" ? f.list_ref : undefined);

/** A link inside one config: which row, where, and the version it holds. */
type Ref = {
  lib_id: number;
  step: StepConfig;
  groupIndex: number;
  fieldIndex: number;
  target: GroupTarget;
  field_id: string;
  ver: number;
};

/** Every field of the config linked to an option list. */
function listRefsIn(cfg: RouteFieldsConfig): Ref[] {
  const out: Ref[] = [];
  for (const step of Object.values(cfg.steps)) {
    step.groups.forEach((g, groupIndex) => g.fields.forEach((f, fieldIndex) => {
      const ref = listRefOf(f);
      if (ref) out.push({ lib_id: ref.id, step, groupIndex, fieldIndex, target: g.target, field_id: f.id, ver: ref.ver });
    }));
  }
  return out;
}

/** Every cell of the config holding fields of a field set: one per (group, set), at the first of
 *  those fields, with the OLDEST version among them — a cell is outdated while any of its set's
 *  fields is. Section headers carry no link (schema.ts), so they never make a cell. */
function setCellsIn(cfg: RouteFieldsConfig): Ref[] {
  const out: Ref[] = [];
  for (const step of Object.values(cfg.steps)) {
    step.groups.forEach((g, groupIndex) => {
      const bySet = new Map<number, Ref>();
      g.fields.forEach((f, fieldIndex) => {
        const ref = fromSetOf(f);
        if (!ref) return;
        const cell = bySet.get(ref.id);
        if (!cell) bySet.set(ref.id, { lib_id: ref.id, step, groupIndex, fieldIndex, target: g.target, field_id: f.id, ver: ref.ver });
        else if (ref.ver < cell.ver) cell.ver = ref.ver;
      });
      out.push(...bySet.values());
    });
  }
  return out;
}

type Place = Ref & { route: RouteRow; in: "draft" | "published"; stepPos: number };

/** The step's position in the live route; a step the route does not have sorts last. */
function stepPosition(route: RouteRow, uid: string): number {
  const i = route.step_uids.length === route.route_steps.length ? route.step_uids.indexOf(uid) : -1;
  return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
}

function byPlace(a: Place, b: Place): number {
  return a.route.test_route_id - b.route.test_route_id
    || a.stepPos - b.stepPos
    || (a.step.uid < b.step.uid ? -1 : a.step.uid > b.step.uid ? 1 : 0)
    || a.groupIndex - b.groupIndex
    || a.fieldIndex - b.fieldIndex;
}

/**
 * Every place of every row of the kind, by row id, in route / step / row order. Per route the
 * draft is scanned first; a published place the draft also holds is not counted again (the
 * draft's version is the one the place will publish with).
 */
function placesByRow(routes: readonly RouteConfigs[], kind: LibraryKind): Map<number, Place[]> {
  const scan = kind === "list" ? listRefsIn : setCellsIn;
  const keyOf = (r: Ref) => `${r.lib_id}|${r.step.uid}|${kind === "list" ? r.field_id : targetKey(r.target)}`;
  const out = new Map<number, Place[]>();
  for (const rc of routes) {
    const seen = new Set<string>();
    for (const [which, cfg] of [["draft", rc.draft], ["published", rc.published]] as const) {
      if (!cfg) continue;
      for (const ref of scan(cfg)) {
        const key = keyOf(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        let list = out.get(ref.lib_id);
        if (!list) out.set(ref.lib_id, (list = []));
        list.push({ ...ref, route: rc.route, in: which, stepPos: stepPosition(rc.route, ref.step.uid) });
      }
    }
  }
  for (const list of out.values()) list.sort(byPlace);
  return out;
}

/** The places of one row. */
async function placesOf(db: Db, kind: LibraryKind, id: number): Promise<Place[]> {
  return placesByRow(await loadRouteConfigs(db, { kind, id }), kind).get(id) ?? [];
}

function listUsage(places: readonly Place[]): OptionListView["usage"] {
  return { fields: places.length, routes: new Set(places.map((p) => p.route.test_route_id)).size };
}

function setUsage(places: readonly Place[], version: number): FieldSetView["usage"] {
  return { cells: places.length, outdated: places.filter((p) => p.ver < version).length };
}

/**
 * The places with the labels of artboard 8's chips, "{kit} › {station} › {row}": the kit is the
 * route's own type when the route is a kit's (null on an item route); the station is the live
 * step's station type (the config's informational station_label when the step left the route);
 * the row is the item route's type, or "הקופסה" / "כל פריט במארז" / the item type of a kit cell.
 */
async function describePlaces(db: Db, places: readonly Place[]): Promise<LibraryUse[]> {
  if (places.length === 0) return [];
  const stationRows = await db.$queryRaw<{ id: number; label: string }[]>`
    SELECT test_station_type_id AS id, TRIM(test_type_desc) AS label FROM test_stations_type`;
  const stations = new Map(stationRows.map((r) => [r.id, r.label]));
  const typeRows = places.some((p) => typeof p.target === "object")
    ? await db.$queryRaw<{ id: number; label: string }[]>`SELECT item_type_id AS id, TRIM(item_type_desc) AS label FROM item_types`
    : [];
  const itemTypes = new Map(typeRows.map((r) => [r.id, r.label]));

  return places.map((p) => {
    const { route } = p;
    const pos = p.stepPos < route.route_steps.length ? p.stepPos : -1;
    const stationLabel = (pos >= 0 ? stations.get(route.route_steps[pos]) : undefined) ?? p.step.station_label;
    const t = p.target;
    const itemLabel = t === "item" ? route.item_type_desc
      : t === "box" ? BOX_ROW_LABEL
        : t === "each_item" ? EACH_ITEM_ROW_LABEL
          : itemTypes.get(t.item_type_id) ?? String(t.item_type_id);
    return {
      route_id: route.test_route_id,
      step_uid: p.step.uid,
      target: typeof t === "object" ? { item_type_id: t.item_type_id } : t,
      field_id: p.field_id,
      ver: p.ver,
      in: p.in,
      kit_desc: route.is_package ? route.item_type_desc : null,
      station_label: stationLabel,
      item_label: itemLabel,
    };
  });
}

// ---- views --------------------------------------------------------------------------------------
function listView(row: LibRow, options: ChoiceOption[], places: readonly Place[]): OptionListView {
  return {
    id: row.id,
    name: row.name,
    options,
    version: row.version,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    usage: listUsage(places),
  };
}

function setView(row: LibRow, fields: Field[], places: readonly Place[]): FieldSetView {
  return {
    id: row.id,
    name: row.name,
    fields,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    usage: setUsage(places, row.version),
  };
}

function conflict(kind: LibraryKind, row: LibRow, baseVersion: number, current: OptionListView | FieldSetView): AdminFieldsError {
  return new AdminFieldsError(409, "VERSION_CONFLICT", `${KIND[kind].what} ${row.id} is at version ${row.version}, not ${baseVersion}`, { current });
}

// ---- propagate (drafts only) ----------------------------------------------------------------------
/** Rewrites one route's config for a propagate; null when nothing in it changes. */
type Rewrite = (cfg: RouteFieldsConfig, routeId: number) => RouteFieldsConfig | null;

/** Saves a propagated config as the route's draft, exactly as an autosave would store it (the
 *  sanitized parse; draft_rev + 1). A config the parse refuses is a 422 and nothing is written. */
async function writeDraft(tx: Db, routeId: number, next: RouteFieldsConfig, actor: Actor): Promise<void> {
  let config: RouteFieldsConfig;
  try {
    config = parseRouteFieldsConfig(next);
  } catch (e) {
    if (e instanceof ShapeError) {
      throw new AdminFieldsError(422, "PROPAGATE_INVALID", `Route ${routeId}: the updated draft would not be a valid config (${e.message})`, {
        route_id: routeId,
        path: e.path,
      });
    }
    throw e;
  }
  await tx.$executeRaw`
    UPDATE testing_routes
       SET fields_draft = ${JSON.stringify(config)}::jsonb,
           draft_rev = draft_rev + 1,
           draft_updated_at = now(),
           draft_updated_by = ${actor.username || null}
     WHERE test_route_id = ${routeId}`;
}

/**
 * The shared body of both propagates. The row is held FOR SHARE; the routes to look at are those
 * whose draft or published config links to it (narrowed to the targets' routes when given); each
 * is then locked in ascending id and re-read, and its draft — or, without one, its latest published
 * config — rewritten. Returns how many drafts were written.
 */
async function propagateRow(
  db: PrismaClient,
  kind: LibraryKind,
  id: number,
  input: PropagateInput,
  actor: Actor,
  rewriter: (row: LibRow, targets: LinkTarget[] | null) => Rewrite,
): Promise<PropagateResultJson> {
  requireId(id, kind);
  if (!isRecord(input)) throw badBody("Body must be {targets?}");
  const targets = targetsOf(input.targets);
  return db.$transaction(async (tx) => {
    const row = await loadRow(tx, kind, id, "share");
    const rewrite = rewriter(row, targets);
    const routeIds = (await loadRouteConfigs(tx, { kind, id }))
      .map((rc) => rc.route.test_route_id)
      .filter((routeId) => !targets || targets.some((t) => t.route_id === routeId));
    let updated = 0;
    for (const routeId of routeIds) {
      const rc = await lockRouteConfigs(tx, routeId);
      const base = rc ? rc.draft ?? rc.published : null;
      if (!base) continue;
      const next = rewrite(base, routeId);
      if (!next) continue;
      await writeDraft(tx, routeId, next, actor);
      updated += 1;
    }
    return { updated_drafts: updated };
  }, TX_OPTIONS);
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Option list: every linked field (or each targeted one) gets the list's current options — option
 * ids included — and list_ref.ver = the current version. A field already holding exactly that is
 * left alone.
 */
function relinkListFields(
  list: { id: number; version: number; options: ChoiceOption[] },
  wanted: (routeId: number, stepUid: string, fieldId: string) => boolean,
): Rewrite {
  return (cfg, routeId) => {
    let changed = false;
    const steps: Record<StepUid, StepConfig> = {};
    for (const [uid, step] of Object.entries(cfg.steps)) {
      steps[uid] = {
        ...step,
        groups: step.groups.map((g) => ({
          ...g,
          fields: g.fields.map((f): Field => {
            if (f.type !== "choice_row" && f.type !== "multi_choice") return f;
            const ref = f.list_ref;
            if (!ref || ref.id !== list.id || !wanted(routeId, uid, f.id)) return f;
            if (ref.ver === list.version && sameJson(f.options, list.options)) return f;
            changed = true;
            return { ...f, options: list.options.map((o) => ({ ...o })), list_ref: { id: list.id, ver: list.version } };
          }),
        })),
      };
    }
    return changed ? { schema: 1, steps } : null;
  };
}

/** A field id in none of `taken` (ids are unique per step, across its groups). */
function freshFieldId(taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = newFieldId();
    if (!taken.has(id)) return id;
  }
  throw new Error("could not mint a free field id");
}

/**
 * Field set: in every cell holding fields of the set (or each targeted cell) whose oldest such
 * field is behind the current version, those fields are replaced — in place, at the position of
 * the first — by the set's current fields under FRESH field ids (unique in the step: none of its
 * other fields', none of the replaced ones'), each with from_set {id, ver: current}; option and
 * checklist item ids are kept. Section headers of the set are not copied: a section cannot carry
 * from_set, so a later propagate could never find it again to replace it.
 */
function relinkSetCells(
  set: { id: number; version: number; fields: Field[] },
  wanted: (routeId: number, stepUid: string, cellFieldIds: string[]) => boolean,
): Rewrite {
  const template = set.fields.filter((f): f is InputField => f.type !== "section");
  return (cfg, routeId) => {
    let changed = false;
    const steps: Record<StepUid, StepConfig> = {};
    for (const [uid, step] of Object.entries(cfg.steps)) {
      const taken = new Set(step.groups.flatMap((g) => g.fields.map((f) => f.id)));
      const groups = step.groups.map((g) => {
        const held = g.fields.flatMap((f) => {
          const ref = fromSetOf(f);
          return ref && ref.id === set.id ? [ref.ver] : [];
        });
        if (held.length === 0 || Math.min(...held) >= set.version || !wanted(routeId, uid, g.fields.map((f) => f.id))) return g;
        changed = true;
        const fresh = template.map((f): Field => {
          const id = freshFieldId(taken);
          taken.add(id);
          return { ...(JSON.parse(JSON.stringify(f)) as InputField), id, from_set: { id: set.id, ver: set.version } };
        });
        const fields: Field[] = [];
        let placed = false;
        for (const f of g.fields) {
          if (fromSetOf(f)?.id !== set.id) fields.push(f);
          else if (!placed) {
            fields.push(...fresh);
            placed = true;
          }
        }
        return { ...g, fields };
      });
      steps[uid] = { ...step, groups };
    }
    return changed ? { schema: 1, steps } : null;
  };
}

// ---- option lists -----------------------------------------------------------------------------------
/** GET /api/settings/option-lists — every non-archived list (ascending id), with its usage. */
export async function listOptionLists(db: PrismaClient): Promise<OptionListView[]> {
  return db.$transaction(async (tx) => {
    const rows = await tx.option_lists.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    if (rows.length === 0) return [];
    const places = placesByRow(await loadRouteConfigs(tx, null), "list");
    return rows.map((r) => {
      const row: LibRow = { ...r, payload: r.options };
      return listView(row, storedOptions(row), places.get(r.id) ?? []);
    });
  }, READ_TX);
}

/** POST /api/settings/option-lists — { name, options } → the new list, version 1. */
export async function createOptionList(db: Db, input: OptionListInput, actor: Actor): Promise<OptionListView> {
  if (!isRecord(input)) throw badBody("Body must be {name, options}");
  const name = nameOf(input.name);
  const options = optionsOf(input.options);
  const r = await db.option_lists.create({
    data: { name, options: options as unknown as Prisma.InputJsonValue, updated_by: actor.username || null },
  });
  return listView({ ...r, payload: r.options }, options, []);
}

/**
 * PUT /api/settings/option-lists/[id] — { name, options, base_version } → { version, linked }: the
 * list becomes version + 1; `linked` = every place linked to it (any version), for the propagate
 * that offers them the new options (spec §5.7 "החל על השדה").
 */
export async function updateOptionList(db: PrismaClient, id: number, input: OptionListInput, actor: Actor): Promise<OptionListSavedJson> {
  requireId(id, "list");
  if (!isRecord(input)) throw badBody("Body must be {name, options, base_version}");
  const name = nameOf(input.name);
  const options = optionsOf(input.options);
  const baseVersion = baseVersionOf(input.base_version);
  return db.$transaction(async (tx) => {
    const row = await loadRow(tx, "list", id, "update");
    if (row.version !== baseVersion) {
      throw conflict("list", row, baseVersion, listView(row, storedOptions(row), await placesOf(tx, "list", id)));
    }
    const [saved] = await tx.$queryRaw<{ version: number }[]>`
      UPDATE option_lists
         SET name = ${name},
             options = ${JSON.stringify(options)}::jsonb,
             version = version + 1,
             updated_at = now(),
             updated_by = ${actor.username || null}
       WHERE id = ${id}
      RETURNING version`;
    const linked = (await placesOf(tx, "list", id)).map((p) => ({ route_id: p.route.test_route_id, step_uid: p.step.uid, field_id: p.field_id }));
    return { version: saved.version, linked };
  }, TX_OPTIONS);
}

/** GET /api/settings/option-lists/[id]/usage — every linked field, with its chip labels. */
export async function optionListUsage(db: PrismaClient, id: number): Promise<LibraryUse[]> {
  requireId(id, "list");
  return db.$transaction(async (tx) => {
    await loadRow(tx, "list", id, null);
    return describePlaces(tx, await placesOf(tx, "list", id));
  }, READ_TX);
}

/**
 * POST /api/settings/option-lists/[id]/propagate — { targets? } → { updated_drafts }: the linked
 * fields (all, or the targets) take the list's current options in their routes' DRAFTS (artboard
 * 4: "…יחול על N שדות … לאחר פרסום").
 */
export async function propagateOptionList(db: PrismaClient, id: number, input: PropagateInput, actor: Actor): Promise<PropagateResultJson> {
  return propagateRow(db, "list", id, input, actor, (row, targets) =>
    relinkListFields(
      { id: row.id, version: row.version, options: storedOptions(row) },
      (routeId, stepUid, fieldId) =>
        !targets || targets.some((t) => t.route_id === routeId && t.step_uid === stepUid && t.field_id === fieldId),
    ));
}

/**
 * DELETE /api/settings/option-lists/[id] — archived = true, unless a draft or a published version
 * links a field to it, or a (non-archived) field set's field does: 409 IN_USE.
 */
export async function deleteOptionList(db: PrismaClient, id: number, actor: Actor): Promise<{ id: number; archived: true }> {
  requireId(id, "list");
  return db.$transaction(async (tx) => {
    await loadRow(tx, "list", id, "update");
    const places = await placesOf(tx, "list", id);
    const sets = await tx.$queryRaw<{ id: number; name: string }[]>`
      SELECT id, name
        FROM field_sets
       WHERE NOT archived
         AND COALESCE(jsonb_path_exists(fields, ${SET_FIELDS_LIST_PATH}::jsonpath, jsonb_build_object('id', ${id}::int), true), false)
       ORDER BY id`;
    if (places.length > 0 || sets.length > 0) {
      throw new AdminFieldsError(409, "IN_USE", `Option list ${id} is in use`, { usage: listUsage(places), field_sets: sets });
    }
    await tx.$executeRaw`
      UPDATE option_lists SET archived = true, updated_at = now(), updated_by = ${actor.username || null} WHERE id = ${id}`;
    return { id, archived: true as const };
  }, TX_OPTIONS);
}

// ---- field sets ---------------------------------------------------------------------------------------
/** GET /api/settings/field-sets — every non-archived set (ascending id), with its usage. */
export async function listFieldSets(db: PrismaClient): Promise<FieldSetView[]> {
  return db.$transaction(async (tx) => {
    const rows = await tx.field_sets.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    if (rows.length === 0) return [];
    const places = placesByRow(await loadRouteConfigs(tx, null), "set");
    return rows.map((r) => {
      const row: LibRow = { ...r, payload: r.fields };
      return setView(row, storedSetFields(row), places.get(r.id) ?? []);
    });
  }, READ_TX);
}

/** POST /api/settings/field-sets — { name, fields } → the new set, version 1. */
export async function createFieldSet(db: Db, input: FieldSetInput, actor: Actor): Promise<FieldSetView> {
  if (!isRecord(input)) throw badBody("Body must be {name, fields}");
  const name = nameOf(input.name);
  const fields = setFieldsOf(input.fields);
  const r = await db.field_sets.create({
    data: { name, fields: fields as unknown as Prisma.InputJsonValue, updated_by: actor.username || null },
  });
  return setView({ ...r, payload: r.fields }, fields, []);
}

/**
 * PUT /api/settings/field-sets/[id] — "שמירה כגרסה {v+1}" (artboard 8): { name, fields,
 * base_version } → { version }. The linked cells keep the version they copied (the map marks them
 * "הערכה עודכנה") until propagate.
 */
export async function updateFieldSet(db: PrismaClient, id: number, input: FieldSetInput, actor: Actor): Promise<FieldSetSavedJson> {
  requireId(id, "set");
  if (!isRecord(input)) throw badBody("Body must be {name, fields, base_version}");
  const name = nameOf(input.name);
  const fields = setFieldsOf(input.fields);
  const baseVersion = baseVersionOf(input.base_version);
  return db.$transaction(async (tx) => {
    const row = await loadRow(tx, "set", id, "update");
    if (row.version !== baseVersion) {
      throw conflict("set", row, baseVersion, setView(row, storedSetFields(row), await placesOf(tx, "set", id)));
    }
    const [saved] = await tx.$queryRaw<{ version: number }[]>`
      UPDATE field_sets
         SET name = ${name},
             fields = ${JSON.stringify(fields)}::jsonb,
             version = version + 1,
             updated_at = now(),
             updated_by = ${actor.username || null}
       WHERE id = ${id}
      RETURNING version`;
    return { version: saved.version };
  }, TX_OPTIONS);
}

/** GET /api/settings/field-sets/[id]/usage — every cell holding the set's fields ("בשימוש ב-9
 *  תאים"; a cell with ver below the set's version is one of "N תאים משתמשים בגרסה קודמת"). */
export async function fieldSetUsage(db: PrismaClient, id: number): Promise<LibraryUse[]> {
  requireId(id, "set");
  return db.$transaction(async (tx) => {
    await loadRow(tx, "set", id, null);
    return describePlaces(tx, await placesOf(tx, "set", id));
  }, READ_TX);
}

/**
 * POST /api/settings/field-sets/[id]/propagate — "עדכן את כולם ({n})" (artboard 8): { targets? } →
 * { updated_drafts }. The outdated cells (all, or those holding a target's field) take the set's
 * current fields in their routes' DRAFTS ("שום תא לא משתנה בלי פרסום").
 */
export async function propagateFieldSet(db: PrismaClient, id: number, input: PropagateInput, actor: Actor): Promise<PropagateResultJson> {
  return propagateRow(db, "set", id, input, actor, (row, targets) =>
    relinkSetCells(
      { id: row.id, version: row.version, fields: storedSetFields(row) },
      (routeId, stepUid, cellFieldIds) =>
        !targets || targets.some((t) => t.route_id === routeId && t.step_uid === stepUid && cellFieldIds.includes(t.field_id)),
    ));
}

/** DELETE /api/settings/field-sets/[id] — archived = true, unless a draft or a published version
 *  holds its fields: 409 IN_USE. */
export async function deleteFieldSet(db: PrismaClient, id: number, actor: Actor): Promise<{ id: number; archived: true }> {
  requireId(id, "set");
  return db.$transaction(async (tx) => {
    const row = await loadRow(tx, "set", id, "update");
    const places = await placesOf(tx, "set", id);
    if (places.length > 0) {
      throw new AdminFieldsError(409, "IN_USE", `Field set ${id} is in use`, { usage: setUsage(places, row.version) });
    }
    await tx.$executeRaw`
      UPDATE field_sets SET archived = true, updated_at = now(), updated_by = ${actor.username || null} WHERE id = ${id}`;
    return { id, archived: true as const };
  }, TX_OPTIONS);
}
