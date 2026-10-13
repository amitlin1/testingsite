import { stepConfigOf, targetKey } from "@/app/lib/station-fields/schema";
import type { Field, GroupTarget, RouteFieldsConfig, StepUid, Tone, VersionRef } from "@/app/lib/station-fields/schema";
import type { Issue } from "@/app/lib/station-fields/validate";
import type { ContextLineJson, FieldsContextJson, RouteFieldsJson, SharedKitJson, StationTypeJson } from "@/app/lib/station-fields/admin-types";
import { contextRouteIds, contextRoutes, jsonEqual, sortedLines } from "./draftModel";
import { BOX_ROW_TEXT, EACH_ITEM_ROW_TEXT, lineRouteMissingText, lineSubText, qtyText, seqText } from "./labels";

/**
 * The fields map (route-fields spec §5.4.1, §5.4.3; artboards 1, 11): columns × rows × cells, built
 * from GET …/fields-context and the WORKING COPY of every route (draftStore), so the map shows
 * unsaved edits. Pure — FieldsMap.tsx and the cell editor draw from it.
 *
 * Kit (kind "package"):
 *   columns = the FIRST step of the kit route (package-level), the merge of the per-item steps of
 *             every line's item route keyed by (station_type_id, occurrence), the LAST step of the
 *             kit route;
 *   rows    = "הקופסה", "כל פריט במארז", one per package_contents line (sort_order).
 *   A package-level cell is a group of the KIT route's step: box / each_item / {item_type_id}.
 *   An item cell is the group "item" of the line's own route at the step of that (type, occurrence)
 *   — decision 4: editing it edits the item route, which other kits may share.
 * Single item route (kind "item", no artboard — spec §5.4.1 "לא אומת"): one row, one column per
 *   step; a package-level step is "—" (its fields live on the kit's route).
 *
 * Every cell is bound to (route_id, step_uid, target) — never to a column index (spec §11.3).
 */

// ---- the model ------------------------------------------------------------------------------------
/** Where a cell's fields live: the group `target` of step `step_uid` of route `route_id`. */
export type CellBinding = { route_id: number; step_uid: StepUid; target: GroupTarget };

/** What a new StepConfig for the cell's step carries (draftModel.setGroupFields). */
export type StepMeta = { station_type_id: number; station_label: string; scope: "package" | "item" };

export type MapColumn = {
  /** "kit:{index}" for a kit step; "step:{station_type_id}:{occurrence}" for a per-item step. */
  key: string;
  /** 1-based place — the number in the header's circle, and "שלב {n} מתוך {total}". */
  n: number;
  stationTypeId: number;
  /** The k-th time the station type appears in the steps behind the column (1 = first). */
  occurrence: number;
  /** test_stations_type.test_type_desc (trimmed); `ID {n}` when the type is unknown (page.tsx). */
  label: string;
  /** A kit step: "כרטיס מארז", one frame for the whole column. */
  packageLevel: boolean;
  /** Kit columns: the kit route's step uid (null when the route's uids do not line up). */
  kitStepUid: StepUid | null;
  /** "מוגדרים {defined}/{relevant}". */
  defined: number;
  relevant: number;
  /** Σ fieldCount and Σ errorCount of the column's cells — the editor's station stops (artboard 2). */
  fieldCount: number;
  errorCount: number;
};

/** Why a cell is "—" ("לא במסלול"). */
export type NaReason =
  /** "הקופסה" / "כל פריט במארז" in a per-item column. */
  | "not_item_row"
  /** The line's route does not pass this station (artboard 1's tooltip). */
  | "not_on_route"
  /** The line has no item route (ContextLineJson.missing), or the kit no route of its own. */
  | "route_missing"
  /** The route's step_uids do not line up with its route_steps: no step can be bound. */
  | "no_step_uids"
  /** Kind "item": a package-level step — its fields are configured on the kit's map. */
  | "package_level";

type CellBase = {
  /** cellKey: "{rowKey}|{columnKey}". */
  key: string;
  rowKey: string;
  columnKey: string;
};

export type MapNaCell = CellBase & {
  na: true;
  reason: NaReason;
  /** reason "not_on_route": "{item} לא עוברת בעמדת {station} במסלול {r}" (notOnRouteTooltip). */
  tooltip: { item: string; station: string; routeNumber: number } | null;
};

export type MapCell = CellBase & {
  na: false;
  binding: CellBinding;
  stepMeta: StepMeta;
  /** The station and the row as the cell's name says them: "{station} · {row}" (cellLabel). */
  stationLabel: string;
  rowLabel: string;
  packageLevel: boolean;
  /** Input fields of the working copy (section headers do not count). 0 = "ללא שדות". */
  fieldCount: number;
  /** The same count in the published version. */
  publishedFieldCount: number;
  /** The distinct option tones of the cell, in the order pass → warn → fail → neutral (the dots).
   *  A pass_fail field brings pass and fail. */
  tones: Tone[];
  /** Errors on the cell: lint errors of its group, and route errors of its step as a whole. */
  errorCount: number;
  /** The cell's fields differ between the published version and the working copy. */
  unpublished: boolean;
  /** The field set the cell's fields came from — the first linked field's — or null. */
  fromSet: VersionRef | null;
  /** A linked field holds an older version of its set than `setVersions` names ("הערכה עודכנה"). */
  outdated: boolean;
  /** Kits other than the one on screen whose template runs the cell's route. */
  sharedWith: SharedKitJson[];
};

export type AnyMapCell = MapCell | MapNaCell;

export type MapRowKind = "box" | "each_item" | "line" | "item";

export type MapRow = {
  /** "box" | "each_item" | "line:{line_id}" | "item". */
  key: string;
  kind: MapRowKind;
  /** "הקופסה" / "כל פריט במארז" / the item type's name — the {row} of "{station} · {row}". */
  label: string;
  /** "שדות על המארז עצמו" / "שדות משותפים לכל הפריטים" / "מסלול {r} · {n} עמדות" (or why the route
   *  is missing). */
  sub: string;
  /** Line rows: "01" / "02–03" and "×2"; "" otherwise. */
  seq: string;
  qty: string;
  line: ContextLineJson | null;
  /** Line / item rows: the item type and the route of its per-item cells. */
  itemTypeId: number | null;
  routeId: number | null;
  routeNumber: number | null;
  /** Line / item rows: every step of the route ("{n} עמדות"); null without a route. */
  stepCount: number | null;
  /** Kits other than the one on screen that run this row's route ("משותף ל: …", Link2). */
  sharedWith: SharedKitJson[];
  /** One per column, in column order. */
  cells: AnyMapCell[];
};

export type MapTotals = {
  /** Σ fieldCount — "37 שדות". */
  fields: number;
  /** Cells that could hold fields. */
  relevantCells: number;
  /** Cells with at least one field. */
  definedCells: number;
  /** Relevant cells without fields — "5 תאים ללא שדות", the chip "ללא שדות · 5". */
  emptyCells: number;
  /** Cells with an error — the chip "שגיאות · 1". */
  errorCells: number;
  /** Distinct errors on the map's cells — the footer's "שגיאה אחת". */
  errors: number;
  /** Cells with unpublished changes — the chip "לא פורסמו · 1". */
  unpublishedCells: number;
  /** Defined cells whose route another kit runs, and their fields — artboard 11's footer. */
  sharedCells: number;
  sharedFields: number;
};

/** One error the map can point at: the map's error bar "{station} · {item}: …" + "עבור לשדה". */
export type MapError = { routeId: number; issue: Issue; cell: MapCell | null; fieldLabel: string | null };

export type MapEmptyState = "route_missing" | "no_steps" | "no_contents";

export type FieldsMapModel = {
  kind: FieldsContextJson["kind"];
  columns: MapColumn[];
  rows: MapRow[];
  /** Every cell by cellKey. */
  cells: ReadonlyMap<string, AnyMapCell>;
  /** "כיסוי {defined}/{relevant}". */
  coverage: { defined: number; relevant: number };
  totals: MapTotals;
  /** Artboard 11's onboarding: no cell this route holds has a field, in the draft or the published
   *  version. A cell whose route another kit runs belongs to that route, not to this one. */
  onboarding: boolean;
  /** Artboard 11's info bar: per line, the shared cells that already have fields. */
  sharedFilled: { rowKey: string; itemTypeDesc: string; routeNumber: number; kits: SharedKitJson[]; cells: number }[];
  /** Every error of every route, the ones on a cell first (in column, then row order). */
  errors: MapError[];
  /** Artboard 11's other states; null = draw the map. */
  emptyState: MapEmptyState | null;
};

export type MapInput = {
  context: FieldsContextJson;
  /** The working copy of each route by test_route_id (draftStore). A route missing here shows
   *  its server draft, else its published version. */
  configs?: Readonly<Record<number, RouteFieldsConfig>>;
  /** The issues of each route's working copy (draftStore issuesByRoute). Missing = none. */
  issues?: Readonly<Record<number, readonly Issue[]>>;
  /** The latest version of each field set, by id — marks "הערכה עודכנה". */
  setVersions?: Readonly<Record<number, number>>;
};

// ---- keys and lookups ----------------------------------------------------------------------------
/** A cell's key: "{rowKey}|{columnKey}". */
export function cellKey(cell: { rowKey: string; columnKey: string }): string {
  return cell.rowKey + "|" + cell.columnKey;
}

/** A binding's key: "{route_id}|{step_uid}|{targetKey}" — the same group whatever row shows it. */
export function bindingKey(b: CellBinding): string {
  return b.route_id + "|" + b.step_uid + "|" + targetKey(b.target);
}

export function sameBinding(a: CellBinding, b: CellBinding): boolean {
  return bindingKey(a) === bindingKey(b);
}

export function getCell(model: FieldsMapModel, rowKey: string, columnKey: string): AnyMapCell | null {
  return model.cells.get(rowKey + "|" + columnKey) ?? null;
}

export function getRow(model: FieldsMapModel, rowKey: string): MapRow | null {
  return model.rows.find((r) => r.key === rowKey) ?? null;
}

export function getColumn(model: FieldsMapModel, columnKey: string): MapColumn | null {
  return model.columns.find((c) => c.key === columnKey) ?? null;
}

/** The cells that can hold fields, row by row. */
export function relevantCells(model: FieldsMapModel): MapCell[] {
  const out: MapCell[] = [];
  for (const row of model.rows) for (const c of row.cells) if (!c.na) out.push(c);
  return out;
}

/** A column's cells that can hold fields, top to bottom — "בחירת כל התאים בעמדה", and the editor's
 *  target chips ("פריט: מחשב · 5 · מסך ×2 · 3"). */
export function columnCells(model: FieldsMapModel, columnKey: string): MapCell[] {
  const out: MapCell[] = [];
  for (const row of model.rows) {
    const c = row.cells.find((x) => x.columnKey === columnKey);
    if (c && !c.na) out.push(c);
  }
  return out;
}

/** The cell the editor URL names (?step=&target=): a package target is a cell of the kit column
 *  with that step uid; "item" the first per-item cell bound to that step uid. A step uid is unique
 *  within its route, and every route of a context mints its own, so the pair names one group. */
export function findCell(model: FieldsMapModel, stepUid: StepUid, target: GroupTarget): MapCell | null {
  const key = targetKey(target);
  for (const row of model.rows) {
    for (const c of row.cells) {
      if (!c.na && c.binding.step_uid === stepUid && targetKey(c.binding.target) === key) return c;
    }
  }
  return null;
}

/** Every cell bound to the same group as `binding` (two lines on one route show one group). */
export function cellsOfBinding(model: FieldsMapModel, binding: CellBinding): MapCell[] {
  const key = bindingKey(binding);
  return relevantCells(model).filter((c) => bindingKey(c.binding) === key);
}

/** The fields of a group in a config, [] when the step or the group does not exist. */
export function groupFieldsOf(cfg: RouteFieldsConfig | null | undefined, stepUid: StepUid, target: GroupTarget): Field[] {
  const step = cfg ? stepConfigOf(cfg, stepUid) : undefined;
  if (!step) return [];
  const key = targetKey(target);
  return step.groups.find((g) => targetKey(g.target) === key)?.fields ?? [];
}

// ---- building ------------------------------------------------------------------------------------
const TONE_ORDER: readonly Tone[] = ["pass", "warn", "fail", "neutral"];
const EMPTY: RouteFieldsConfig = { schema: 1, steps: {} };

type Stations = Readonly<Record<number, StationTypeJson>>;

const isPackageLevel = (stations: Stations, typeId: number): boolean => stations[typeId]?.package_level === true;

/** The column label: the station type's name, or `ID {n}` as the steps editor shows an unknown type. */
function stationLabel(stations: Stations, typeId: number): string {
  return stations[typeId]?.label?.trim() || `ID ${typeId}`;
}

/** A step of a route with its place among the route's steps of the same station type. */
type Slot = { typeId: number; occurrence: number; uid: StepUid | null; index: number };

/** The route's steps (all, or only the per-item ones), each with its occurrence. uid is null when
 *  step_uids does not line up with route_steps. */
function slotsOf(route: RouteFieldsJson["route"], stations: Stations, perItemOnly: boolean): Slot[] {
  const aligned = route.step_uids.length === route.route_steps.length;
  const seen = new Map<number, number>();
  const out: Slot[] = [];
  route.route_steps.forEach((typeId, index) => {
    if (perItemOnly && isPackageLevel(stations, typeId)) return;
    const occurrence = (seen.get(typeId) ?? 0) + 1;
    seen.set(typeId, occurrence);
    out.push({ typeId, occurrence, uid: aligned ? route.step_uids[index] || null : null, index });
  });
  return out;
}

const stepColumnKey = (typeId: number, occurrence: number) => `step:${typeId}:${occurrence}`;

/**
 * The per-item columns of a kit: the per-item steps of every line's route, merged in line order.
 * A column already seen keeps its place; a new one goes right after the last column this route
 * has passed so far (at the start when it has passed none). (לא אומת — the artboards do not
 * define how routes that order the stations differently merge; spec §5.4.1.)
 */
function mergeItemColumns(routes: readonly Slot[][]): { typeId: number; occurrence: number }[] {
  const cols: { key: string; typeId: number; occurrence: number }[] = [];
  for (const slots of routes) {
    let last = -1;
    for (const s of slots) {
      const key = stepColumnKey(s.typeId, s.occurrence);
      const at = cols.findIndex((c) => c.key === key);
      if (at >= 0) {
        last = Math.max(last, at);
      } else {
        cols.splice(last + 1, 0, { key, typeId: s.typeId, occurrence: s.occurrence });
        last += 1;
      }
    }
  }
  return cols;
}

const inputFields = (fields: readonly Field[]): Field[] => fields.filter((f) => f.type !== "section");

function tonesOf(fields: readonly Field[]): Tone[] {
  const has = new Set<Tone>();
  for (const f of fields) {
    if (f.type === "choice_row" || f.type === "multi_choice") for (const o of f.options) has.add(o.tone);
    if (f.type === "pass_fail") {
      has.add("pass");
      has.add("fail");
    }
  }
  return TONE_ORDER.filter((t) => has.has(t));
}

/** The kits that run a route, other than the one on screen. */
function otherKits(route: RouteFieldsJson, ctx: FieldsContextJson): SharedKitJson[] {
  const onScreen = ctx.kind === "package" ? ctx.subject.item_type_id : null;
  return route.shared_with.filter((k) => k.package_type_id !== onScreen);
}

type Builder = {
  ctx: FieldsContextJson;
  stations: Stations;
  configOf: (route: RouteFieldsJson) => RouteFieldsConfig;
  issuesOf: (routeId: number) => readonly Issue[];
  setVersions: Readonly<Record<number, number>>;
};

function naCell(rowKey: string, columnKey: string, reason: NaReason, tooltip: MapNaCell["tooltip"] = null): MapNaCell {
  return { key: rowKey + "|" + columnKey, rowKey, columnKey, na: true, reason, tooltip };
}

function boundCell(
  b: Builder,
  row: { key: string; label: string },
  col: { key: string; label: string; packageLevel: boolean; stationTypeId: number },
  route: RouteFieldsJson,
  stepUid: StepUid,
  target: GroupTarget,
  sharedWith: SharedKitJson[],
): MapCell {
  const routeId = route.route.test_route_id;
  const fields = groupFieldsOf(b.configOf(route), stepUid, target);
  const published = groupFieldsOf(route.published, stepUid, target);
  const inputs = inputFields(fields);
  const tKey = targetKey(target);
  let errorCount = 0;
  for (const i of b.issuesOf(routeId)) {
    if (i.level !== "error" || i.step_uid !== stepUid) continue;
    if (i.target == null || targetKey(i.target) === tKey) errorCount += 1;
  }
  let fromSet: VersionRef | null = null;
  let outdated = false;
  for (const f of inputs) {
    if (f.type === "section" || !f.from_set) continue;
    fromSet ??= { id: f.from_set.id, ver: f.from_set.ver };
    const latest = b.setVersions[f.from_set.id];
    if (latest != null && latest > f.from_set.ver) outdated = true;
  }
  return {
    key: row.key + "|" + col.key,
    rowKey: row.key,
    columnKey: col.key,
    na: false,
    binding: { route_id: routeId, step_uid: stepUid, target },
    stepMeta: { station_type_id: col.stationTypeId, station_label: col.label, scope: col.packageLevel ? "package" : "item" },
    stationLabel: col.label,
    rowLabel: row.label,
    packageLevel: col.packageLevel,
    fieldCount: inputs.length,
    publishedFieldCount: inputFields(published).length,
    tones: tonesOf(inputs),
    errorCount,
    unpublished: !jsonEqual(fields, published),
    fromSet,
    outdated,
    sharedWith,
  };
}

type ColumnDraft = {
  key: string;
  stationTypeId: number;
  occurrence: number;
  label: string;
  packageLevel: boolean;
  kitStepUid: StepUid | null;
};

/** Build the map. */
export function buildFieldsMap(input: MapInput): FieldsMapModel {
  const ctx = input.context;
  const stations = ctx.stations;
  const b: Builder = {
    ctx,
    stations,
    configOf: (r) => input.configs?.[r.route.test_route_id] ?? r.draft ?? r.published ?? EMPTY,
    issuesOf: (id) => input.issues?.[id] ?? [],
    setVersions: input.setVersions ?? {},
  };
  const columns: ColumnDraft[] = [];
  const rows: MapRow[] = [];
  let emptyState: MapEmptyState | null = null;

  if (ctx.kind === "package") {
    const kit = ctx.kit;
    const lines = sortedLines(ctx);
    if (!kit) emptyState = "route_missing";
    else if (kit.route.route_steps.length === 0) emptyState = "no_steps";
    else if (lines.length === 0) emptyState = "no_contents";

    // Kit columns: the first and the last step of the kit route, when package-level. A per-item
    // step in the middle of the kit route has no cell (the spec's map draws none).
    const kitSlots = kit ? slotsOf(kit.route, stations, false) : [];
    const kitColumn = (s: Slot): ColumnDraft => ({
      key: `kit:${s.index}`,
      stationTypeId: s.typeId,
      occurrence: s.occurrence,
      label: stationLabel(stations, s.typeId),
      packageLevel: true,
      kitStepUid: s.uid,
    });
    const first = kitSlots[0];
    const last = kitSlots.length > 1 ? kitSlots[kitSlots.length - 1] : undefined;
    if (first && isPackageLevel(stations, first.typeId)) columns.push(kitColumn(first));
    const itemSlots = lines.map((l) => (l.route ? slotsOf(l.route.route, stations, true) : []));
    for (const c of mergeItemColumns(itemSlots)) {
      columns.push({
        key: stepColumnKey(c.typeId, c.occurrence),
        stationTypeId: c.typeId,
        occurrence: c.occurrence,
        label: stationLabel(stations, c.typeId),
        packageLevel: false,
        kitStepUid: null,
      });
    }
    if (last && isPackageLevel(stations, last.typeId)) columns.push(kitColumn(last));

    const kitCells = (rowKey: string, rowLabel: string, target: GroupTarget): AnyMapCell[] =>
      columns.map((col) => {
        if (!col.packageLevel) return naCell(rowKey, col.key, "not_item_row");
        if (!kit) return naCell(rowKey, col.key, "route_missing");
        if (col.kitStepUid == null) return naCell(rowKey, col.key, "no_step_uids");
        return boundCell(b, { key: rowKey, label: rowLabel }, col, kit, col.kitStepUid, target, []);
      });

    rows.push(fixedRow("box", BOX_ROW_TEXT, kitCells("box", BOX_ROW_TEXT.title, "box")));
    rows.push(fixedRow("each_item", EACH_ITEM_ROW_TEXT, kitCells("each_item", EACH_ITEM_ROW_TEXT.title, "each_item")));
    lines.forEach((line, li) => {
      const rowKey = `line:${line.line_id}`;
      const route = line.route;
      const slots = itemSlots[li];
      const sharedWith = route ? otherKits(route, ctx) : [];
      const label = line.item_type_desc;
      const cells = columns.map((col): AnyMapCell => {
        if (col.packageLevel) {
          if (!kit) return naCell(rowKey, col.key, "route_missing");
          if (col.kitStepUid == null) return naCell(rowKey, col.key, "no_step_uids");
          return boundCell(b, { key: rowKey, label }, col, kit, col.kitStepUid, { item_type_id: line.item_type_id }, []);
        }
        if (!route) return naCell(rowKey, col.key, "route_missing");
        const slot = slots.find((s) => s.typeId === col.stationTypeId && s.occurrence === col.occurrence);
        if (!slot) return naCell(rowKey, col.key, "not_on_route", { item: label, station: col.label, routeNumber: line.route_number });
        if (slot.uid == null) return naCell(rowKey, col.key, "no_step_uids");
        return boundCell(b, { key: rowKey, label }, col, route, slot.uid, "item", sharedWith);
      });
      const stepCount = route ? route.route.route_steps.length : null;
      rows.push({
        key: rowKey,
        kind: "line",
        label,
        sub: route ? lineSubText(line.route_number, route.route.route_steps.length) : lineRouteMissingText(line.route_number),
        seq: seqText(line.seq_from, line.seq_to),
        qty: qtyText(line.quantity),
        line,
        itemTypeId: line.item_type_id,
        routeId: route ? route.route.test_route_id : null,
        routeNumber: line.route_number,
        stepCount,
        sharedWith,
        cells,
      });
    });
  } else {
    const item = ctx.item;
    if (!item) emptyState = "route_missing";
    else if (item.route.route_steps.length === 0) emptyState = "no_steps";
    const slots = item ? slotsOf(item.route, stations, false) : [];
    for (const s of slots) {
      columns.push({
        key: stepColumnKey(s.typeId, s.occurrence),
        stationTypeId: s.typeId,
        occurrence: s.occurrence,
        label: stationLabel(stations, s.typeId),
        packageLevel: isPackageLevel(stations, s.typeId),
        kitStepUid: null,
      });
    }
    const label = ctx.subject.desc;
    const sharedWith = item ? otherKits(item, ctx) : [];
    const cells = columns.map((col, i): AnyMapCell => {
      const slot = slots[i];
      if (!item) return naCell("item", col.key, "route_missing");
      if (col.packageLevel) return naCell("item", col.key, "package_level");
      if (slot.uid == null) return naCell("item", col.key, "no_step_uids");
      return boundCell(b, { key: "item", label }, col, item, slot.uid, "item", sharedWith);
    });
    rows.push({
      key: "item",
      kind: "item",
      label,
      sub: item ? lineSubText(ctx.subject.route_number, item.route.route_steps.length) : lineRouteMissingText(ctx.subject.route_number),
      seq: "",
      qty: "",
      line: null,
      itemTypeId: ctx.subject.item_type_id,
      routeId: item ? item.route.test_route_id : null,
      routeNumber: ctx.subject.route_number,
      stepCount: item ? item.route.route_steps.length : null,
      sharedWith,
      cells,
    });
  }

  return finish(ctx, columns, rows, emptyState, b);
}

function fixedRow(key: "box" | "each_item", text: { title: string; sub: string }, cells: AnyMapCell[]): MapRow {
  return {
    key, kind: key, label: text.title, sub: text.sub, seq: "", qty: "", line: null,
    itemTypeId: null, routeId: null, routeNumber: null, stepCount: null, sharedWith: [], cells,
  };
}

/** Column counts, totals, coverage, onboarding and the error list. */
function finish(ctx: FieldsContextJson, drafts: ColumnDraft[], rows: MapRow[], emptyState: MapEmptyState | null, b: Builder): FieldsMapModel {
  const cells = new Map<string, AnyMapCell>();
  const totals: MapTotals = {
    fields: 0, relevantCells: 0, definedCells: 0, emptyCells: 0, errorCells: 0, errors: 0,
    unpublishedCells: 0, sharedCells: 0, sharedFields: 0,
  };
  const perColumn = new Map(drafts.map((c) => [c.key, { defined: 0, relevant: 0, fieldCount: 0, errorCount: 0 }]));
  let ownFields = false;
  const sharedFilled: FieldsMapModel["sharedFilled"] = [];

  for (const row of rows) {
    let sharedHere = 0;
    for (const c of row.cells) {
      cells.set(c.key, c);
      if (c.na) continue;
      const col = perColumn.get(c.columnKey)!;
      col.relevant += 1;
      col.fieldCount += c.fieldCount;
      col.errorCount += c.errorCount;
      totals.relevantCells += 1;
      totals.fields += c.fieldCount;
      if (c.fieldCount > 0) {
        col.defined += 1;
        totals.definedCells += 1;
      } else {
        totals.emptyCells += 1;
      }
      if (c.errorCount > 0) totals.errorCells += 1;
      if (c.unpublished) totals.unpublishedCells += 1;
      const shared = c.sharedWith.length > 0;
      if (shared && c.fieldCount > 0) {
        totals.sharedCells += 1;
        totals.sharedFields += c.fieldCount;
        sharedHere += 1;
      }
      if (!shared && (c.fieldCount > 0 || c.publishedFieldCount > 0)) ownFields = true;
    }
    if (sharedHere > 0 && row.routeNumber != null) {
      sharedFilled.push({ rowKey: row.key, itemTypeDesc: row.label, routeNumber: row.routeNumber, kits: row.sharedWith, cells: sharedHere });
    }
  }

  const columns: MapColumn[] = drafts.map((c, i) => ({ ...c, n: i + 1, ...perColumn.get(c.key)! }));

  // Errors: the ones on a cell in column, then row order (the error bar shows the first); a route
  // error on no cell (a step that left the route) after them, in route order.
  const errors: MapError[] = [];
  const placed = new Set<Issue>();
  for (const col of columns) {
    for (const row of rows) {
      const c = row.cells.find((x) => x.columnKey === col.key);
      if (!c || c.na || c.errorCount === 0) continue;
      const tKey = targetKey(c.binding.target);
      const fields = groupFieldsOf(routeConfig(ctx, b, c.binding.route_id), c.binding.step_uid, c.binding.target);
      for (const issue of b.issuesOf(c.binding.route_id)) {
        if (issue.level !== "error" || issue.step_uid !== c.binding.step_uid || placed.has(issue)) continue;
        if (issue.target != null && targetKey(issue.target) !== tKey) continue;
        placed.add(issue);
        const field = issue.field_id ? fields.find((f) => f.id === issue.field_id) : undefined;
        errors.push({ routeId: c.binding.route_id, issue, cell: c, fieldLabel: field ? field.label : null });
      }
    }
  }
  totals.errors = errors.length;
  for (const id of contextRouteIds(ctx)) {
    for (const issue of b.issuesOf(id)) {
      if (issue.level === "error" && !placed.has(issue)) errors.push({ routeId: id, issue, cell: null, fieldLabel: null });
    }
  }

  return {
    kind: ctx.kind,
    columns,
    rows,
    cells,
    coverage: { defined: totals.definedCells, relevant: totals.relevantCells },
    totals,
    onboarding: emptyState == null && !ownFields,
    sharedFilled,
    errors,
    emptyState,
  };
}

function routeConfig(ctx: FieldsContextJson, b: Builder, routeId: number): RouteFieldsConfig {
  const r = contextRoutes(ctx).find((x) => x.route.test_route_id === routeId);
  return r ? b.configOf(r) : EMPTY;
}
