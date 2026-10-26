import { newChecklistItemId, newFieldId, newOptionId } from "@/app/lib/station-fields/step-uids";
import { targetKey } from "@/app/lib/station-fields/schema";
import type {
  ChecklistField, ChecklistItem, ChecklistItemId, ChoiceOption, ChoiceRowField, Field, FieldId, FieldType, GroupTarget,
  MultiChoiceField, OptionId, PhotoField, Tone,
} from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import type { Issue } from "@/app/lib/station-fields/validate";
import { bindingKey, columnCells } from "./mapModel";
import type { FieldsMapModel, MapCell, MapRow } from "./mapModel";
import { DEFAULT_CHOICE_OPTIONS, EDITOR_UNDRAWN_TEXT, EDITOR_TEXT, stopSubText } from "./labels";
import { findDefaultCheckList } from "./libraryModel";

/**
 * The station field editor's pure half (route-fields spec §5.5, §5.15, §5.16, §10.3; artboard 2):
 * the field list edits the rows table makes, the counts of the footer and the chips, the station
 * bar and the target chips drawn from the map model, and the locked rows of the popup the station
 * really opens. StationFieldEditor.tsx and its parts draw what these return; every edit goes back
 * through draftModel.setGroupFields.
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
/** A choice field's options: a choice row or a multi choice. */
export type OptionField = ChoiceRowField | MultiChoiceField;

export const isOptionField = (f: Field): f is OptionField => f.type === "choice_row" || f.type === "multi_choice";

/** Artboard 2's new-row options ("תקינות כללית"), each with an id of its own. */
export function defaultOptions(ids: IdSource = DEFAULT_IDS): ChoiceOption[] {
  return DEFAULT_CHOICE_OPTIONS.map((o) => ({ id: ids.option(), label: o.label, tone: o.tone }));
}

/** A shared option list as newField needs it (OptionListJson's members). */
export type SharedListLike = { id: number; name: string; version: number; options: readonly ChoiceOption[] };

/**
 * A new row of `type`. Artboard 2's "הוסף שורת בדיקה": a choice row with the "תקינות כללית" options,
 * notes "חובה בכשל", not required, no name yet — LINKED to the shared list "תקינות כללית" (list_ref and
 * a copy of its options) when `lists` has it, else a local copy of artboard 2's options. Every other
 * type takes the same notes / required defaults (spec §5.14's defaults for pasted rows); a number
 * field counts out of range as a fail (artboard 3 draws the switch on); a section is "מקטע חדש".
 */
export function newField(type: FieldType, ids: IdSource = DEFAULT_IDS, lists: readonly SharedListLike[] | null = null): Field {
  const id = ids.field();
  if (type === "section") return { id, type, label: EDITOR_TEXT.newSection };
  const base = { id, label: "", required: false, notes: "required_on_fail" as const };
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

// ---- options (artboard 2 rule: any change to an option unlinks the field from its shared list) -----
function withOptions<F extends OptionField>(f: F, options: ChoiceOption[]): F {
  const next = { ...f, options };
  delete next.list_ref;
  return next;
}

export function renameOption<F extends OptionField>(f: F, optionId: OptionId, label: string): F {
  return withOptions(f, f.options.map((o) => (o.id === optionId ? { ...o, label } : o)));
}

export function setOptionTone<F extends OptionField>(f: F, optionId: OptionId, tone: Tone): F {
  return withOptions(f, f.options.map((o) => (o.id === optionId ? { ...o, tone } : o)));
}

export function removeOption<F extends OptionField>(f: F, optionId: OptionId): F {
  return withOptions(f, f.options.filter((o) => o.id !== optionId));
}

/** "+ אפשרות": "אפשרות חדשה", neutral, at the end (artboard 2 `addChip`). */
export function addOption<F extends OptionField>(f: F, ids: IdSource = DEFAULT_IDS): { field: F; optionId: OptionId } {
  const option: ChoiceOption = { id: ids.option(), label: EDITOR_TEXT.newOption, tone: "neutral" };
  return { field: withOptions(f, [...f.options, option]), optionId: option.id };
}

/** The field with its worker help text as typed; blank text removes it (no empty help is stored). */
export function withFieldHelp<F extends Exclude<Field, { type: "section" }>>(f: F, help: string): F {
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

/** "Enter" in the add input: a box named `label` (trimmed, at most LIMITS.checklistLabel) at the end,
 *  with an id of its own. Nothing changes (itemId null) for a blank label or a full list. */
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

/** The photo type (photo_types.code); "" while none is chosen — the lint's PHOTO_TYPE_EMPTY. */
export function withPhotoType(f: PhotoField, code: string): PhotoField {
  return { ...f, photo_type: code.slice(0, LIMITS.photoType) };
}

/** "מינ׳" as typed: a whole number clamped to 0..LIMITS.photoMin, or null while the text holds none
 *  (empty) — the field then keeps its minimum. Anything but digits is dropped. */
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
  const copy = JSON.parse(JSON.stringify(fields[at])) as Field;
  copy.id = ids.field();
  if (copy.type === "choice_row" || copy.type === "multi_choice") copy.options = copy.options.map((o) => ({ ...o, id: ids.option() }));
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
    if (f.type === "section") continue;
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
/** What is open in the editor: a chip in rename (+ ToneMenu), a checklist box in rename, a row's
 *  notes / note length listbox, a row's option list popover (artboard 4), a row's ⋯ menu, the type
 *  picker (artboard 3), the card's ⋯ menu. Opening one closes the other. */
export type EditorPopover =
  | { kind: "option"; fieldId: FieldId; optionId: OptionId }
  | { kind: "checkItem"; fieldId: FieldId; itemId: ChecklistItemId }
  | { kind: "notes"; fieldId: FieldId }
  | { kind: "noteMax"; fieldId: FieldId }
  | { kind: "list"; fieldId: FieldId }
  | { kind: "rowMenu"; fieldId: FieldId; anchor: HTMLElement }
  | { kind: "picker" }
  | { kind: "cellMenu"; anchor: HTMLElement };

/** The row a popover belongs to, if any. */
export function popoverFieldId(p: EditorPopover | null): FieldId | null {
  return p != null && "fieldId" in p ? p.fieldId : null;
}

// ---- the popup the station opens (spec §10.3 last row) -------------------------------------------
/** What the worker's popup is: VerdictStation, PhotoStation, PopUpTestDialog, a package wizard, or
 *  the station type's popup template (docs/popup-templates/PLAN.md). */
export type PopupKind = "verdict" | "photo" | "dialog" | "package" | "template";

/** The worker screen's choice (src/app/testing/page.tsx `packageKindOf`): a kit at its route's last
 *  step (of more than one) is closing, else opening. */
export type PackageWizard = "open" | "close";

/** How the station's popup is looked up — mainPopUp.ts, passed in so this module stays pure.
 *  hasTemplate: the station type has a popup template (it wins over the code's wizard). */
export type PopupLookup = { hasWizard(typeId: number): boolean; isVerdict(typeId: number): boolean; hasTemplate?(typeId: number): boolean };

export function popupKindOf(stationTypeId: number, packageLevel: boolean, lookup: PopupLookup): PopupKind {
  if (packageLevel) return "package";
  if (lookup.hasTemplate?.(stationTypeId)) return "template";
  if (!lookup.hasWizard(stationTypeId)) return "dialog";
  return lookup.isVerdict(stationTypeId) ? "verdict" : "photo";
}

/** The wizard of a package-level step at `index` of a kit route of `steps` steps. */
export function packageWizardAt(index: number, steps: number): PackageWizard {
  return steps > 1 && index + 1 >= steps ? "close" : "open";
}

/** The locked rows above and below the fields table (artboard 2 ב/ה). Artboard 2's wording is
 *  VerdictStation's and PhotoStation's; the others are undrawn (spec §10.3). */
export function lockedRowTexts(kind: PopupKind, wizard: PackageWizard | null, target: GroupTarget): { top: string; bottom: string } {
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
      if (wizard === "close") return { top: box ? c.lockedTopCloseBox : c.lockedTopCloseItem, bottom: c.lockedBottomClose };
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
  /** "{N} שדות" / "שדה אחד" / "שגיאה". */
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

/** "העמדה הקודמת" / "העמדה הבאה": the nearest stop before / after the current one that has a cell to
 *  open, or null. */
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

/** A chip's lead (artboards 2, 7): an item column "מחשב" / "מסך ×2"; a package-level column "הקופסה",
 *  "כל פריט", "01 מחשב", "02–03 מסך". */
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
