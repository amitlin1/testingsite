import type { ChoiceRowField, Field, FieldId, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS, takenLabels } from "@/app/lib/station-fields/validate";
import { DEFAULT_IDS, newField } from "./editorModel";
import type { IdSource, SharedListLike } from "./editorModel";
import { EDITOR_TEXT } from "./labels";

/**
 * "הדבק מאקסל" — rows pasted from a spreadsheet as tab-separated text (route-fields spec §5.14,
 * artboard 2's title "הדביקו שורות: שם⇥אפשרות 1⇥אפשרות 2⇥…"). Pure: the editor's paste, the map's
 * paste of system-clipboard text (bulkModel) and the tests share it.
 *
 *   שם השדה<TAB>אפשרות 1<TAB>אפשרות 2<TAB>אפשרות 3<TAB>אפשרות 4
 *   נורית מתח	תקין	מהבהבת	לא דולקת	לא נבדק
 *
 * The text (UTF-8, already decoded by the browser) splits into lines on \r?\n; every cell is
 * trimmed, empty cells at the end of a line are dropped, and a line left without cells is skipped.
 * The first line is a header — and skipped — when its first cell is "שם השדה".
 *
 * Each line becomes a choice row ("שורת בדיקה"), notes "חובה בכשל", not required:
 *   one cell     the name, with the default options — exactly "הוסף שורת בדיקה" (editorModel.newField:
 *                linked to the shared list "תקינות כללית" when it exists, else artboard 2's options);
 *   two or more  the first is the name, the rest the options in order. Options that are EXACTLY a
 *                shared list (the same labels in the same order) link the field to that list
 *                (list_ref + the list's options); otherwise each option takes the tone of the first
 *                shared-list option with the same label (lists in the order given, first wins), or
 *                neutral.
 * A name the cell already has (trimmed, validate.takenLabels) is skipped, and so is a name repeated
 * further down the paste. What is too long for the shape check is cut to its limits (a name to 80,
 * an option to 60, 12 options a row, 60 fields a cell), so an autosave is never refused for it.
 * The lint runs on the result like on any edit (draftStore).
 */

/** The first cell of a header line — the editor's own column title. */
export const TSV_HEADER = EDITOR_TEXT.colName;

/** One pasted line: the field's name and its options, in order. */
export type TsvRow = { label: string; options: string[] };

/** The lines of a paste (see above). */
export function parseTsvRows(text: string): TsvRow[] {
  const out: TsvRow[] = [];
  let first = true;
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const cells = line.split("\t").map((c) => c.trim());
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) continue;
    const header = first && cells[0] === TSV_HEADER;
    first = false;
    if (header) continue;
    out.push({ label: cells[0], options: cells.slice(1) });
  }
  return out;
}

/** The shared list whose options are exactly these labels, in this order, or null. */
export function exactSharedList<L extends SharedListLike>(labels: readonly string[], lists: readonly L[] | null | undefined): L | null {
  if (!lists || labels.length === 0) return null;
  return lists.find((l) => l.options.length === labels.length && l.options.every((o, i) => o.label.trim() === labels[i])) ?? null;
}

/** The tone of the first shared-list option labelled `label` (lists in order), else neutral. */
export function sharedTone(label: string, lists: readonly SharedListLike[] | null | undefined): Tone {
  for (const l of lists ?? []) {
    for (const o of l.options) if (o.label.trim() === label) return o.tone;
  }
  return "neutral";
}

/** The choice row of one pasted line (see above). */
export function tsvRowField(row: TsvRow, lists: readonly SharedListLike[] | null = null, ids: IdSource = DEFAULT_IDS): ChoiceRowField {
  const label = row.label.slice(0, LIMITS.fieldLabel);
  if (row.options.length === 0) return { ...(newField("choice_row", ids, lists) as ChoiceRowField), label };
  const labels = row.options.slice(0, LIMITS.options).map((o) => o.slice(0, LIMITS.optionLabel));
  const base = { id: ids.field(), label, required: false, notes: "required_on_fail" as const, type: "choice_row" as const };
  const exact = exactSharedList(labels, lists);
  if (exact) return { ...base, options: exact.options.map((o) => ({ ...o })), list_ref: { id: exact.id, ver: exact.version } };
  return { ...base, options: labels.map((l) => ({ id: ids.option(), label: l, tone: sharedTone(l, lists) })) };
}

export type TsvInsertOptions = {
  /** The shared option lists (useOptionLists): the default row's link, exact links and tones. */
  lists?: readonly SharedListLike[] | null;
  ids?: IdSource;
  /** Insert after this field (the focused row); at the end when it is null or not in the list. */
  after?: FieldId | null;
  /** Fields the worker sees on the same card ahead of the cell's (each_item's, for a kit item at a
   *  package-level step): their names are taken too (bulkModel.alongsideFields). */
  alongside?: readonly Field[];
  /** Field ids the step already uses in its other groups (ids are unique per step). */
  takenIds?: ReadonlySet<string>;
};

export type TsvInsert = {
  /** The cell's list after the paste. */
  fields: Field[];
  /** The new rows' ids, in order. */
  added: FieldId[];
  /** Lines whose name the cell already had (or that repeated an earlier line). */
  skipped: number;
  /** Lines left out because the cell is full (LIMITS.fieldsPerList). */
  overflow: number;
};

/** The cell's fields with the pasted lines inserted after `after` (or at the end) — one list, so
 *  the caller makes ONE draft edit of it. */
export function insertTsvRows(existing: readonly Field[], rows: readonly TsvRow[], opts: TsvInsertOptions = {}): TsvInsert {
  const ids = opts.ids ?? DEFAULT_IDS;
  const taken = takenLabels([...(opts.alongside ?? []), ...existing]);
  const used = new Set<string>([...(opts.takenIds ?? []), ...existing.map((f) => f.id)]);
  const room = Math.max(0, LIMITS.fieldsPerList - existing.length);
  const fresh: Field[] = [];
  let skipped = 0;
  let overflow = 0;
  for (const row of rows) {
    const f = tsvRowField(row, opts.lists ?? null, ids);
    const name = f.label.trim();
    if (name && taken.has(name)) {
      skipped += 1;
      continue;
    }
    if (fresh.length >= room) {
      overflow += 1;
      continue;
    }
    while (used.has(f.id)) f.id = ids.field();
    used.add(f.id);
    if (name) taken.add(name);
    fresh.push(f);
  }
  const at = opts.after != null ? existing.findIndex((f) => f.id === opts.after) : -1;
  const pos = at >= 0 ? at + 1 : existing.length;
  const fields = [...existing.slice(0, pos), ...fresh, ...existing.slice(pos)];
  return { fields, added: fresh.map((f) => f.id), skipped, overflow };
}
