import { newChecklistItemId, newFieldId, newOptionId } from "@/app/lib/station-fields/step-uids";
import { targetKey } from "@/app/lib/station-fields/schema";
import type {
  ChecklistField, ChecklistItem, ChecklistItemId, ChoiceOption, Field, FieldId, FieldType, GroupTarget, InputField, OptionId, StepUid,
} from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { roleAtStep } from "@/app/lib/popup-templates/placement";
import { codePopupKindOf } from "@/app/lib/testing/popup-kind";
import type { PackageRole } from "@/app/lib/popup-templates/schema";
import { bindingKey } from "./cellGroups";
import { alignedStepUids } from "./fieldsContext";
import { columnCells } from "./mapModel";
import type { FieldsMapModel, MapCell, MapRow } from "./mapModel";
import { findDefaultCheckList, isInputField, isOptionField } from "./optionFields";
import { DEFAULT_CHOICE_OPTIONS, EDITOR_UNDRAWN_TEXT, EDITOR_TEXT, stopSubText } from "./labels";

/**
 * The station field editor's pure half (route-fields spec §5.5, §5.15, §5.16, §10.3; artboard 2):
 * the field list edits the rows table makes, the counts of the footer and the chips, the station
 * bar and the target chips drawn from the map model, and the locked rows of the popup the station
 * really opens. StationFieldEditor.tsx and the field list components draw what these return (the
 * library's field set editor shares the list edits).
 */

// ---- ids -------------------------------------------------------------------------------------------
/** Where new ids come from (step-uids.ts; tests pass their own). */
export type IdSource = { field(): FieldId; option(): OptionId; item(): ChecklistItemId };

export const DEFAULT_IDS: IdSource = {
  field: () => newFieldId(),
  option: () => newOptionId(),
  item: () => newChecklistItemId(),
};

// ---- new rows -------------------------------------------------------------------------------------
/** Artboard 2's new-row options, each with an id of its own. */
export function defaultOptions(ids: IdSource = DEFAULT_IDS): ChoiceOption[] {
  return DEFAULT_CHOICE_OPTIONS.map((o) => ({ id: ids.option(), label: o.label, tone: o.tone }));
}

/** What every new input field starts with (a row added, a pasted line). */
export const NEW_FIELD_DEFAULTS = { label: "", required: false, notes: "required_on_fail" } as const;

/** A shared option list as newField needs it (OptionListJson's members). */
export type SharedListLike = { id: number; name: string; version: number; options: readonly ChoiceOption[] };

/**
 * A new row of `type`. Artboard 2's "הוסף שורת בדיקה": a choice row, notes required on a fail, not
 * required, no name yet — LINKED to the default shared list (findDefaultCheckList: list_ref and a copy
 * of its options) when `lists` has it, else a local copy of artboard 2's options. Every other type
 * takes the same notes / required defaults (spec §5.14's defaults for pasted rows); a number field
 * counts out of range as a fail (artboard 3 draws the switch on).
 */
export function newField(type: FieldType, ids: IdSource = DEFAULT_IDS, lists: readonly SharedListLike[] | null = null): Field {
  const id = ids.field();
  if (type === "section") return { id, type, label: EDITOR_TEXT.newSection };
  const base = { id, ...NEW_FIELD_DEFAULTS };
  switch (type) {
    case "choice_row": {
      const shared = findDefaultCheckList(lists);
      return shared
        ? { ...base, type, options: shared.options.map((o) => ({ ...o })), list_ref: { id: shared.id, ver: shared.version } }
        : { ...base, type, options: defaultOptions(ids) };
    }
    case "multi_choice":
      return { ...base, type, options: defaultOptions(ids) };
    case "number":
      return { ...base, type, out_of_range_fail: true };
    case "checklist":
      return { ...base, type, items: [] };
    case "photo":
      return { ...base, type, photo_type: "", min: 1 };
    case "pass_fail":
    case "text":
    case "textarea":
    case "scan":
      return { ...base, type };
  }
}

/** Types whose row opens expanded when added (artboard 3: "פותח אותה מורחבת אם יש לה הגדרות"). Only the
 *  number field has a drawn settings panel. */
export function opensExpanded(type: FieldType): boolean {
  return type === "number";
}

/** The field with its worker help text as typed; blank text removes it (no empty help is stored). */
export function withFieldHelp<F extends InputField>(f: F, help: string): F {
  const next = { ...f };
  if (help.trim() === "") delete next.help;
  else next.help = help;
  return next;
}

// ---- checklist and photo settings (spec §5.5.2: "photo: photo_type … ו-min. checklist: items[]") ----
/** Room for one more box (validate.ts LIMITS.checklistItems). */
export function canAddChecklistItem(f: ChecklistField): boolean {
  return f.items.length < LIMITS.checklistItems;
}

/** A box named `label` (trimmed, cut to LIMITS.checklistLabel) at the end, with an id of its own.
 *  Nothing changes (itemId null) for a blank label or a full list. */
export function addChecklistItem(f: ChecklistField, label: string, ids: IdSource = DEFAULT_IDS): { field: ChecklistField; itemId: ChecklistItemId | null } {
  const text = label.trim().slice(0, LIMITS.checklistLabel);
  if (!text || !canAddChecklistItem(f)) return { field: f, itemId: null };
  const item: ChecklistItem = { id: ids.item(), label: text };
  return { field: { ...f, items: [...f.items, item] }, itemId: item.id };
}

/** A box renamed in place, as typed (an empty name is the lint's CHECKLIST_ITEM_LABEL_EMPTY). */
export function renameChecklistItem(f: ChecklistField, itemId: ChecklistItemId, label: string): ChecklistField {
  return { ...f, items: f.items.map((it) => (it.id === itemId ? { ...it, label } : it)) };
}

export function removeChecklistItem(f: ChecklistField, itemId: ChecklistItemId): ChecklistField {
  return { ...f, items: f.items.filter((it) => it.id !== itemId) };
}

/** A photo field's minimum as typed: a whole number clamped to LIMITS.photoMin, or null while the text
 *  holds none (empty) — the field then keeps its minimum. Anything but digits is dropped. */
export function parsePhotoMin(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  return Math.min(LIMITS.photoMin, Number(digits.slice(0, 3)));
}

// ---- the field list -------------------------------------------------------------------------------
export function replaceField(fields: readonly Field[], next: Field): Field[] {
  return fields.map((f) => (f.id === next.id ? next : f));
}

export function removeField(fields: readonly Field[], id: FieldId): Field[] {
  return fields.filter((f) => f.id !== id);
}

/** A copy of the field right after it, with new ids for it, its options and its checklist items
 *  (ids are minted once and never shared). The name stays the same — the lint warns about the
 *  duplicate until the admin renames one (spec §5.15). */
export function duplicateField(fields: readonly Field[], id: FieldId, ids: IdSource = DEFAULT_IDS): { fields: Field[]; id: FieldId | null } {
  const at = fields.findIndex((f) => f.id === id);
  if (at < 0) return { fields: [...fields], id: null };
  const copy = structuredClone(fields[at]);
  copy.id = ids.field();
  if (isOptionField(copy)) copy.options = copy.options.map((o) => ({ ...o, id: ids.option() }));
  if (copy.type === "checklist") copy.items = copy.items.map((it) => ({ ...it, id: ids.item() }));
  const out = [...fields];
  out.splice(at + 1, 0, copy);
  return { fields: out, id: copy.id };
}

/** The field moved to index `to` (clamped). The same array content when nothing moves. */
export function moveField(fields: readonly Field[], id: FieldId, to: number): Field[] {
  const from = fields.findIndex((f) => f.id === id);
  if (from < 0) return [...fields];
  const dest = Math.max(0, Math.min(fields.length - 1, to));
  if (dest === from) return [...fields];
  const out = [...fields];
  const [moved] = out.splice(from, 1);
  out.splice(dest, 0, moved);
  return out;
}

/** Alt+↑ / Alt+↓ (spec §5.16): one place up (-1) or down (+1). */
export function moveFieldBy(fields: readonly Field[], id: FieldId, delta: -1 | 1): Field[] {
  const from = fields.findIndex((f) => f.id === id);
  return from < 0 ? [...fields] : moveField(fields, id, from + delta);
}

/** A drop of the dragged row on `targetId`, before or after it (HTML5 DnD on the handle). */
export function dropField(fields: readonly Field[], dragId: FieldId, targetId: FieldId, after: boolean): Field[] {
  if (dragId === targetId) return [...fields];
  const without = fields.filter((f) => f.id !== dragId);
  const dragged = fields.find((f) => f.id === dragId);
  const at = without.findIndex((f) => f.id === targetId);
  if (!dragged || at < 0) return [...fields];
  without.splice(after ? at + 1 : at, 0, dragged);
  return without;
}

// ---- counts ---------------------------------------------------------------------------------------
/** Artboard 2's footer and sub-tab: named input fields, required ones, and unnamed ones (sections
 *  never count). */
export function editorCounts(fields: readonly Field[]): { named: number; required: number; unnamed: number } {
  let named = 0;
  let required = 0;
  let unnamed = 0;
  for (const f of fields) {
    if (!isInputField(f)) continue;
    if (f.label.trim()) named += 1;
    else unnamed += 1;
    if (f.required) required += 1;
  }
  return { named, required, unnamed };
}

/** Artboard 2's chip count (`namedCount`). */
export function namedFieldCount(fields: readonly Field[]): number {
  return editorCounts(fields).named;
}

/** The lint issues of one field, errors first. */
export function issuesOfField(issues: readonly Issue[], fieldId: FieldId): Issue[] {
  const own = issues.filter((i) => i.field_id === fieldId);
  return [...own.filter((i) => i.level === "error"), ...own.filter((i) => i.level !== "error")];
}

/** The issues of a cell's group among a route's issues. */
export function issuesOfGroup(issues: readonly Issue[], stepUid: string, target: GroupTarget): Issue[] {
  const key = targetKey(target);
  return issues.filter((i) => i.step_uid === stepUid && i.target != null && targetKey(i.target) === key);
}

// ---- the one popover open at a time (spec §5.5.2: artboard 2's `edit`, `notesOpen`, `lenOpen`) -----
/** What is open in a field list (and the station editor's ⋯ menu). Opening one closes the other. */
export type EditorPopover =
  | { kind: "option"; fieldId: FieldId; optionId: OptionId }
  | { kind: "checkItem"; fieldId: FieldId; itemId: ChecklistItemId }
  | { kind: "notes"; fieldId: FieldId }
  | { kind: "noteMax"; fieldId: FieldId }
  | { kind: "list"; fieldId: FieldId }
  | { kind: "rowMenu"; fieldId: FieldId; anchor: HTMLElement }
  | { kind: "picker" }
  | { kind: "cellMenu"; anchor: HTMLElement };

// ---- the popup the station opens (spec §10.3 last row) -------------------------------------------
/** What the worker's popup is: VerdictStation, PhotoStation, PopUpTestDialog, a package wizard, or
 *  the station type's popup template (docs/features/popup-templates/PLAN.md). */
export type PopupKind = "verdict" | "photo" | "dialog" | "package" | "template";

/** As the testing page decides it (lib/testing/popup-kind.ts): never a template at a package-level
 *  step, otherwise the type's template (`hasTemplate`: the page's list), otherwise the code's popup. */
export function popupKindOf(stationTypeId: number, packageLevel: boolean, templates: { hasTemplate(typeId: number): boolean }): PopupKind {
  if (packageLevel) return "package";
  if (templates.hasTemplate(stationTypeId)) return "template";
  return codePopupKindOf(stationTypeId);
}

/** The package wizard a step of the kit's own route opens (popup-templates roleAtStep); null when the
 *  kit route does not have the step. */
export function kitStepRole(ctx: FieldsContextJson, stepUid: StepUid): PackageRole | null {
  const route = ctx.kit?.route;
  const at = route ? alignedStepUids(route).indexOf(stepUid) : -1;
  return route && at >= 0 ? roleAtStep(at, route.route_steps.length) : null;
}

/** The locked rows above and below the fields table (artboard 2 ב/ה). Artboard 2's wording is
 *  VerdictStation's and PhotoStation's; the others are undrawn (spec §10.3). */
export function lockedRowTexts(kind: PopupKind, wizard: PackageRole | null, target: GroupTarget): { top: string; bottom: string } {
  const c = EDITOR_UNDRAWN_TEXT;
  switch (kind) {
    case "verdict":
    case "photo":
      return { top: EDITOR_TEXT.lockedTopStation, bottom: EDITOR_TEXT.lockedBottomStation };
    case "dialog":
      return { top: c.lockedTopDialog, bottom: c.lockedBottomDialog };
    case "template":
      return { top: c.lockedTopTemplate, bottom: c.lockedBottomTemplate };
    case "package": {
      const box = target === "box";
      if (wizard === "closing") return { top: box ? c.lockedTopCloseBox : c.lockedTopCloseItem, bottom: c.lockedBottomClose };
      return box
        ? { top: c.lockedTopOpenBox, bottom: c.lockedBottomOpenBox }
        : { top: c.lockedTopOpenItem, bottom: c.lockedBottomOpenItem };
    }
  }
}

// ---- the station bar ------------------------------------------------------------------------------
export type TimelineStop = {
  key: string;
  n: number;
  name: string;
  packageLevel: boolean;
  current: boolean;
  /** stopSubText of the column. */
  sub: string;
  error: boolean;
  /** The cell a press opens; null when the column has none to open. */
  target: MapCell | null;
};

/** The cell to open in `columnKey` when coming from row `rowKey`: the same row's cell when it can
 *  hold fields there, else the column's first one. */
export function stopTargetCell(model: FieldsMapModel, columnKey: string, rowKey: string): MapCell | null {
  const cells = columnCells(model, columnKey);
  return cells.find((c) => c.rowKey === rowKey) ?? cells[0] ?? null;
}

/** One stop per map column (artboard 2 `stops`). */
export function timelineStops(model: FieldsMapModel, current: MapCell): TimelineStop[] {
  return model.columns.map((col) => ({
    key: col.key,
    n: col.n,
    name: col.label,
    packageLevel: col.packageLevel,
    current: col.key === current.columnKey,
    sub: stopSubText(col.fieldCount, col.errorCount),
    error: col.errorCount > 0,
    target: stopTargetCell(model, col.key, current.rowKey),
  }));
}

/** The nearest stop before / after the current one that has a cell to open, or null. */
export function neighbourStop(stops: readonly TimelineStop[], delta: -1 | 1): TimelineStop | null {
  const at = stops.findIndex((s) => s.current);
  if (at < 0) return null;
  for (let i = at + delta; i >= 0 && i < stops.length; i += delta) {
    if (stops[i].target) return stops[i];
  }
  return null;
}

// ---- the target chips -----------------------------------------------------------------------------
export type TargetChip = { key: string; lead: string; cell: MapCell; pressed: boolean };

/** A chip's lead (artboards 2, 7): in an item column the item (with its quantity); in a package-level
 *  column the box, each item, or the line's seq and item. */
export function targetChipLead(row: MapRow, packageLevel: boolean): string {
  if (row.kind === "box") return EDITOR_TEXT.boxChip;
  if (row.kind === "each_item") return EDITOR_TEXT.eachItemChip;
  if (row.kind === "line" && packageLevel) return row.seq + " " + row.label;
  if (row.kind === "line" && (row.line?.quantity ?? 1) > 1) return row.label + " " + row.qty;
  return row.label;
}

/** The chips of the current cell's column: one per cell that can hold fields, top to bottom; two
 *  rows bound to one group (two lines on one route) show one chip. */
export function targetChips(model: FieldsMapModel, current: MapCell): TargetChip[] {
  const seen = new Set<string>();
  const currentKey = bindingKey(current.binding);
  const out: TargetChip[] = [];
  for (const cell of columnCells(model, current.columnKey)) {
    const key = bindingKey(cell.binding);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = model.rows.find((r) => r.key === cell.rowKey);
    if (!row) continue;
    out.push({ key, lead: targetChipLead(row, cell.packageLevel), cell, pressed: key === currentKey });
  }
  return out;
}
