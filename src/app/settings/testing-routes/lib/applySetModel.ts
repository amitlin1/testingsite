import type { Field, FieldId, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import { LIMITS, takenLabels } from "@/app/lib/station-fields/validate";
import type { FieldSetJson } from "@/app/lib/station-fields/admin-types";
import { setGroupFields } from "./draftModel";
import { DEFAULT_IDS } from "./editorModel";
import type { IdSource } from "./editorModel";
import { alongsideFields, applyAdditions, inMapOrder, stepFieldIds, uniqueByBinding } from "./bulkModel";
import type { PasteCounts, RouteEdit } from "./bulkModel";
import { bindingKey, columnCells, getRow, groupFieldsOf } from "./mapModel";
import type { CellBinding, FieldsMapModel, MapCell, StepMeta } from "./mapModel";
import { filterByName } from "./libraryModel";
import { EACH_ITEM_PLACE, duplicateLineText, targetChipText } from "./applySetLabels";

/**
 * "החלת ערכת שדות" — the apply-set dialog's pure half (route-fields spec §5.10, §3.2; artboard 9; lead
 * decision D8): what the cells take, the preview's skip marks and duplicate lines, the target chips,
 * and the draft edits themselves. ApplyFieldSetDialog draws what these return and runs the edits
 * through draftStore.edit — ONE edit per route touched (each route then autosaves on its own; no
 * endpoint of its own, spec §3.2).
 *
 * What a cell takes (D8):
 *   - every field of the set, deep-copied, under a FRESH field id unique in the cell's step (option
 *     and checklist-item ids are kept — they are unique per field);
 *   - "השאר מקושר לערכה" on: every input field carries from_set {id, ver: the set's version} (the
 *     map's "ערכה: {name}" tag, "הערכה עודכנה", the set's usage); off: no from_set — an independent
 *     copy ("יועתקו לתאים כעותק עצמאי");
 *   - section headers are copied too, never with from_set (a section cannot carry it).
 * Modes:
 *   - "add" ("הוסף לשדות הקיימים", the default): after the cell's own fields; a field whose trimmed
 *     name the cell already has — or, for a kit item's group at a package-level step, the step's
 *     each_item group has — is skipped (artboard 9's rule; bulkModel.addToCell, the paste's rule);
 *   - "replace" ("החלף את השדות בתא"): the cell's fields become the set's; nothing is skipped (artboard
 *     9 draws no "יידלג" in this mode).
 * Two rows showing one group (two lines on one route) are one cell to change.
 */

export const APPLY_SET_MODES = ["add", "replace"] as const;
export type ApplySetMode = (typeof APPLY_SET_MODES)[number];

/** The members of a field set the apply needs. */
export type ApplySetSource = Pick<FieldSetJson, "id" | "version" | "fields">;

// ---- what the cells take -----------------------------------------------------------------------
/** The set's fields as the cells take them (before the fresh ids): deep copies, from_set {id, ver}
 *  on every input field when `linked`, none otherwise; a section header as a bare header. */
export function setTemplate(set: ApplySetSource, linked: boolean): Field[] {
  return set.fields.map((f): Field => {
    if (f.type === "section") return { id: f.id, type: "section", label: f.label };
    const copy = JSON.parse(JSON.stringify(f)) as Exclude<Field, { type: "section" }>;
    if (linked) copy.from_set = { id: set.id, ver: set.version };
    else delete copy.from_set;
    return copy;
  });
}

/** A field id of `ids` that `used` does not hold yet (it is then added). */
function freshId(used: Set<string>, ids: IdSource): FieldId {
  let id = ids.field();
  while (used.has(id)) id = ids.field();
  used.add(id);
  return id;
}

/**
 * "החלף את השדות בתא": the group's fields become copies of `template` under fresh ids — none of the
 * step's ids, the replaced ones included (an id is minted once and never reused). Mutates `cfg` (the
 * copy draftStore.edit hands out). Answers the input fields the cell now holds.
 */
export function replaceCell(cfg: RouteFieldsConfig, binding: CellBinding, meta: StepMeta, template: readonly Field[], ids: IdSource = DEFAULT_IDS): number {
  const used = stepFieldIds(cfg, binding.step_uid);
  const out = template.slice(0, LIMITS.fieldsPerList).map((f) => {
    const copy = JSON.parse(JSON.stringify(f)) as Field;
    copy.id = freshId(used, ids);
    return copy;
  });
  setGroupFields(cfg, binding, meta, out);
  return out.filter((f) => f.type !== "section").length;
}

export type ApplySetInput = {
  set: ApplySetSource;
  /** The cells chosen (the selection, the editor's cell …). */
  cells: readonly MapCell[];
  mode: ApplySetMode;
  /** "השאר מקושר לערכה — עדכונים יוצעו לאישור". */
  linked: boolean;
};

/**
 * Applies the set: ONE `edit` per route touched. The counts are the paste's (bulkModel.PasteCounts):
 * cells that took a field (replace: every cell), input fields added, skipped as duplicates, left out
 * because the cell was full; `outside` is always 0.
 */
export function applyFieldSet(edit: RouteEdit, input: ApplySetInput, ids: IdSource = DEFAULT_IDS): PasteCounts {
  const template = setTemplate(input.set, input.linked);
  const cells = uniqueByBinding(input.cells);
  if (input.mode === "add") return applyAdditions(edit, cells.map((cell) => ({ cell, fields: template })), ids);

  const counts: PasteCounts = { cells: 0, added: 0, skipped: 0, overflow: 0, outside: 0 };
  const byRoute = new Map<number, MapCell[]>();
  for (const c of cells) {
    const list = byRoute.get(c.binding.route_id) ?? [];
    list.push(c);
    byRoute.set(c.binding.route_id, list);
  }
  for (const [routeId, list] of byRoute) {
    edit(routeId, (cfg) => {
      for (const c of list) {
        counts.added += replaceCell(cfg, c.binding, c.stepMeta, template, ids);
        counts.cells += 1;
      }
    });
  }
  return counts;
}

// ---- the preview ------------------------------------------------------------------------------------
/** Where a skipped field's name is already taken. */
export type SkipPlace =
  /** In the target cell itself (or an earlier field of the set took it there). */
  | { kind: "cell"; cell: MapCell }
  /** In the each_item group of the target's package-level step. */
  | { kind: "each_item"; cell: MapCell };

export type PreviewRow = {
  field: Field;
  /** "יידלג": the field is skipped in EVERY target cell (add mode). A field skipped in some cells
   *  only has no Tag — its duplicate lines tell where. */
  skip: boolean;
};

export type ApplyPreview = {
  /** One per field of the set, in its order (section headers included). */
  rows: PreviewRow[];
  /** Input fields of the set — "{n} שדות · קריאה בלבד". */
  fieldCount: number;
  /** Every (field, place) a skip happens at, once each, in the cells' order (add mode only). */
  skips: { field: string; place: SkipPlace }[];
};

/**
 * What the dialog shows for `fields` on `cells` with the working copies `configs`
 * (draftModel.currentConfigs): the rows with their "יידלג" mark and where each skip happens — the
 * same walk as bulkModel.addToCell (the cell's names and the alongside names taken; each field adds
 * its own name).
 */
export function applyPreview(
  configs: Readonly<Record<number, RouteFieldsConfig>>,
  cells: readonly MapCell[],
  fields: readonly Field[],
  mode: ApplySetMode,
): ApplyPreview {
  const fieldCount = fields.filter((f) => f.type !== "section").length;
  const targets = uniqueByBinding(cells);
  const skippedIn = fields.map(() => 0);
  const skips: ApplyPreview["skips"] = [];
  const seen = new Set<string>();
  if (mode === "add") {
    for (const cell of targets) {
      const cfg = configs[cell.binding.route_id];
      const own = takenLabels(groupFieldsOf(cfg, cell.binding.step_uid, cell.binding.target));
      const along = takenLabels(alongsideFields(cfg, cell.binding));
      fields.forEach((f, i) => {
        if (f.type === "section") return;
        const name = f.label.trim();
        if (!name) return;
        let place: SkipPlace | null = null;
        if (own.has(name)) place = { kind: "cell", cell };
        else if (along.has(name)) place = { kind: "each_item", cell };
        if (!place) {
          own.add(name);
          return;
        }
        skippedIn[i] += 1;
        const key = name + "|" + (place.kind === "cell" ? bindingKey(cell.binding) : cell.binding.route_id + "|" + cell.binding.step_uid + "|each_item");
        if (seen.has(key)) return;
        seen.add(key);
        skips.push({ field: name, place });
      });
    }
  }
  const rows = fields.map((field, i) => ({ field, skip: targets.length > 0 && skippedIn[i] === targets.length }));
  return { rows, fieldCount, skips };
}

// ---- the "יעד" chips and the sub-line --------------------------------------------------------
export type TargetChip = {
  key: string;
  station: string;
  /** "01" / "02–03" on a template line; "" otherwise. */
  seq: string;
  /** The row: the item, "הקופסה", "כל פריט במארז". */
  item: string;
  /** "×2" for a line of several units; "". */
  qty: string;
  /** The whole chip: "{station} · {seq} {item}[ ×{qty}]". */
  text: string;
};

/** A chip per target cell, in map order (artboard 9: "סגירת מארז · 02–03 מסך ×2"). */
export function targetChips(model: FieldsMapModel, cells: readonly MapCell[]): TargetChip[] {
  return inMapOrder(model, cells).map((cell) => {
    const row = getRow(model, cell.rowKey);
    const line = row?.kind === "line";
    const seq = line ? row.seq : "";
    const qty = line && (row.line?.quantity ?? 1) > 1 ? row.qty : "";
    const item = row?.label ?? cell.rowLabel;
    return { key: cell.key, station: cell.stationLabel, seq, item, qty, text: targetChipText(cell.stationLabel, seq, item, qty) };
  });
}

/** The stations of the cells, once each, in map order (the sub-line's "עמדת {station}"). */
export function cellStations(model: FieldsMapModel, cells: readonly MapCell[]): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const col of model.columns) {
    if (keys.has(col.key) || !cells.some((c) => c.columnKey === col.key)) continue;
    keys.add(col.key);
    out.push(col.label);
  }
  return out;
}

/** Artboard 9's note under the chips ("עמדה ברמת מארז: השדות יופיעו לעובד בשורת כל פריט בתוך כרטיס
 *  המארז."): a target at a package-level step that is not the box — the box's own fields do not
 *  appear in an item's row. */
export function showsPackageNote(cells: readonly MapCell[]): boolean {
  return cells.some((c) => c.packageLevel && c.binding.target !== "box");
}

/** A duplicate line's place: 'כל פריט במארז', or the target cell as its chip says it. */
export function skipPlaceText(model: FieldsMapModel, place: SkipPlace): string {
  if (place.kind === "each_item") return EACH_ITEM_PLACE;
  return targetChips(model, [place.cell])[0]?.text ?? place.cell.rowLabel;
}

/** The duplicate lines (artboard 9), once per text. */
export function duplicateLines(model: FieldsMapModel, preview: ApplyPreview): string[] {
  const out: string[] = [];
  for (const s of preview.skips) {
    const text = duplicateLineText(s.field, skipPlaceText(model, s.place));
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

// ---- the set to start on, and the list ------------------------------------------------------------
/** The set the dialog starts on: `preferred` when the library still has it, else the first. */
export function initialSetId(sets: readonly { id: number }[], preferred: number | null | undefined): number | null {
  if (preferred != null && sets.some((s) => s.id === preferred)) return preferred;
  return sets[0]?.id ?? null;
}

/** The cards the search leaves (artboard 9 `visible`: the name holds the query). */
export function visibleSets<T extends { name: string }>(sets: readonly T[], query: string): T[] {
  return filterByName(sets, query);
}

// ---- entry points --------------------------------------------------------------------------------------
/** The onboarding card's "החל ערכת שדות…" (artboard 11): no cell is selected there, so the dialog takes
 *  the cells of the map's first column that has any (a kit's opening station: the box, each item and
 *  every line). */
export function firstColumnCells(model: FieldsMapModel): MapCell[] {
  for (const col of model.columns) {
    const cells = columnCells(model, col.key);
    if (cells.length > 0) return cells;
  }
  return [];
}

/** "שמור כערכה…": the cell's fields as a new set's — input fields only (a section header is the
 *  cell's layout, not part of a template), from_set dropped (a template is not linked to a template),
 *  each under an id of its own. */
export function cellFieldsForSet(fields: readonly Field[], newId: () => FieldId): Field[] {
  return fields
    .filter((f) => f.type !== "section")
    .map((f) => {
      const copy = JSON.parse(JSON.stringify(f)) as Exclude<Field, { type: "section" }>;
      delete copy.from_set;
      copy.id = newId();
      return copy;
    });
}
