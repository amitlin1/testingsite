import type { Field, FieldId, RouteFieldsConfig } from "@/app/lib/station-fields/schema";
import type { FieldSetJson } from "@/app/lib/station-fields/admin-types";
import { bindingKey } from "./cellGroups";
import { cellStateOf, fillCell } from "./cellFill";
import type { PasteCounts, RouteEdit, SkipPlace as FillSkipPlace } from "./cellFill";
import { DEFAULT_IDS } from "./editorModel";
import type { IdSource } from "./editorModel";
import { applyAdditions, inMapOrder, uniqueByBinding } from "./bulkModel";
import { columnCells, getRow } from "./mapModel";
import type { FieldsMapModel, MapCell } from "./mapModel";
import { inputFields, isInputField } from "./optionFields";
import { EACH_ITEM_ROW_TEXT } from "./labels";
import { duplicateLineText, targetChipText } from "./applySetLabels";

/**
 * "החלת ערכת שדות" — the apply-set dialog's pure half (route-fields spec §5.10, §3.2; artboard 9; lead
 * decision D8): what the cells take, the preview's skip marks and duplicate lines, the target chips,
 * and the draft edits themselves. ApplyFieldSetDialog draws what these return and runs the edits
 * through draftStore.edit — ONE edit per route touched (each route then autosaves on its own; no
 * endpoint of its own, spec §3.2).
 *
 * What a cell takes (D8): every field of the set through cellFill (fresh ids; "add" skips the names
 * the cell has, "replace" — artboard 9 draws no "יידלג" in this mode — skips nothing). "השאר מקושר
 * לערכה" on: every input field carries from_set {id, ver: the set's version} (the map's set tag,
 * "הערכה עודכנה", the set's usage); off: no from_set — an independent copy. Section headers are
 * copied too, never with from_set (a section cannot carry it). Two rows showing one group (two lines
 * on one route) are one cell to change.
 */

export const APPLY_SET_MODES = ["add", "replace"] as const;
export type ApplySetMode = (typeof APPLY_SET_MODES)[number];

/** The members of a field set the apply needs. */
export type ApplySetSource = Pick<FieldSetJson, "id" | "version" | "fields">;

// ---- what the cells take -----------------------------------------------------------------------
/** The set's fields as the cells take them (before the fresh ids): deep copies, from_set {id, ver}
 *  on every input field when `linked`, none otherwise; a section header as a bare header. */
function setTemplate(set: ApplySetSource, linked: boolean): Field[] {
  return set.fields.map((f): Field => {
    if (!isInputField(f)) return { id: f.id, type: "section", label: f.label };
    const copy = structuredClone(f);
    if (linked) copy.from_set = { id: set.id, ver: set.version };
    else delete copy.from_set;
    return copy;
  });
}

export type ApplySetInput = {
  set: ApplySetSource;
  /** The cells chosen (the selection, the editor's cell …). */
  cells: readonly MapCell[];
  mode: ApplySetMode;
  /** The dialog's "stay linked to the set" checkbox. */
  linked: boolean;
};

/**
 * Applies the set: ONE `edit` per route touched. The counts are the paste's (cellFill.PasteCounts):
 * cells that took a field (replace: every cell), input fields added, skipped as duplicates, left out
 * because the cell was full; `outside` is always 0.
 */
export function applyFieldSet(edit: RouteEdit, input: ApplySetInput, ids: IdSource = DEFAULT_IDS): PasteCounts {
  const template = setTemplate(input.set, input.linked);
  return applyAdditions(edit, uniqueByBinding(input.cells).map((cell) => ({ cell, fields: template })), ids, 0, input.mode);
}

// ---- the preview ------------------------------------------------------------------------------------
/** Where a skipped field's name is already taken, in which target cell. */
export type SkipPlace = { kind: FillSkipPlace; cell: MapCell };

export type PreviewRow = {
  field: Field;
  /** The skip Tag: the field is skipped in EVERY target cell (add mode). A field skipped in some cells
   *  only has no Tag — its duplicate lines tell where. */
  skip: boolean;
};

export type ApplyPreview = {
  /** One per field of the set, in its order (section headers included). */
  rows: PreviewRow[];
  /** Input fields of the set (previewCountText). */
  fieldCount: number;
  /** Every (field, place) a skip happens at, once each, in the cells' order (add mode only). */
  skips: { field: string; place: SkipPlace }[];
};

/**
 * What the dialog shows for `fields` on `cells` with the working copies `configs`
 * (draftModel.currentConfigs): the rows with their skip mark and where each skip happens — a dry
 * run of the fill itself (cellFill), so the preview is what the apply does.
 */
export function applyPreview(
  configs: Readonly<Record<number, RouteFieldsConfig>>,
  cells: readonly MapCell[],
  fields: readonly Field[],
  mode: ApplySetMode,
): ApplyPreview {
  const fieldCount = inputFields(fields).length;
  const targets = uniqueByBinding(cells);
  const skippedIn = fields.map(() => 0);
  const skips: ApplyPreview["skips"] = [];
  const seen = new Set<string>();
  for (const cell of targets) {
    for (const s of fillCell(cellStateOf(configs[cell.binding.route_id], cell.binding), fields, { mode }).skips) {
      skippedIn[s.index] += 1;
      const name = fields[s.index].label.trim();
      const key = name + "|" + bindingKey(s.place === "cell" ? cell.binding : { ...cell.binding, target: "each_item" });
      if (seen.has(key)) continue;
      seen.add(key);
      skips.push({ field: name, place: { kind: s.place, cell } });
    }
  }
  const rows = fields.map((field, i) => ({ field, skip: targets.length > 0 && skippedIn[i] === targets.length }));
  return { rows, fieldCount, skips };
}

// ---- the target chips and the sub-line --------------------------------------------------------
export type ApplyTargetChip = {
  key: string;
  station: string;
  /** seqText on a template line; "" otherwise. */
  seq: string;
  /** The row: the item, the box, each item. */
  item: string;
  /** qtyText for a line of several units; "". */
  qty: string;
  /** The whole chip (targetChipText). */
  text: string;
};

/** A chip per target cell, in map order (artboard 9). */
export function applyTargetChips(model: FieldsMapModel, cells: readonly MapCell[]): ApplyTargetChip[] {
  return inMapOrder(model, cells).map((cell) => {
    const row = getRow(model, cell.rowKey);
    const line = row?.kind === "line";
    const seq = line ? row.seq : "";
    const qty = line && (row.line?.quantity ?? 1) > 1 ? row.qty : "";
    const item = row?.label ?? cell.rowLabel;
    return { key: cell.key, station: cell.stationLabel, seq, item, qty, text: targetChipText(cell.stationLabel, seq, item, qty) };
  });
}

/** The stations of the cells, once each, in map order (the sub-line). */
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

/** Artboard 9's note under the chips (APPLY_SET_TEXT.packageNote): a target at a package-level step
 *  that is not the box — the box's own fields do not appear in an item's row. */
export function showsPackageNote(cells: readonly MapCell[]): boolean {
  return cells.some((c) => c.packageLevel && c.binding.target !== "box");
}

/** A duplicate line's place: each item, or the target cell as its chip says it. */
export function skipPlaceText(model: FieldsMapModel, place: SkipPlace): string {
  if (place.kind === "each_item") return EACH_ITEM_ROW_TEXT.title;
  return applyTargetChips(model, [place.cell])[0]?.text ?? place.cell.rowLabel;
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

// ---- entry points --------------------------------------------------------------------------------------
/** The onboarding card's apply-set button (artboard 11): no cell is selected there, so the dialog takes
 *  the cells of the map's first column that has any (a kit's opening station: the box, each item and
 *  every line). */
export function firstColumnCells(model: FieldsMapModel): MapCell[] {
  for (const col of model.columns) {
    const cells = columnCells(model, col.key);
    if (cells.length > 0) return cells;
  }
  return [];
}

/** The editor's save-as-set: the cell's fields as a new set's — input fields only (a section header is the
 *  cell's layout, not part of a template), from_set dropped (a template is not linked to a template),
 *  each under an id of its own. */
export function cellFieldsForSet(fields: readonly Field[], newId: () => FieldId): Field[] {
  return inputFields(fields).map((f) => {
    const copy = structuredClone(f);
    delete copy.from_set;
    copy.id = newId();
    return copy;
  });
}
