import type { ChoiceRowField, Tone } from "@/app/lib/station-fields/schema";
import { LIMITS } from "@/app/lib/station-fields/validate";
import { DEFAULT_IDS, NEW_FIELD_DEFAULTS, newField } from "./editorModel";
import type { IdSource, SharedListLike } from "./editorModel";
import { EDITOR_TEXT } from "./labels";

/**
 * "הדבק מאקסל" — rows pasted from a spreadsheet as tab-separated text (route-fields spec §5.14,
 * artboard 2's title). Pure: the editor's paste and the map's paste of system-clipboard text
 * (bulkModel) read it; cellFill puts the fields into the cell.
 *
 *   שם השדה<TAB>אפשרות 1<TAB>אפשרות 2<TAB>אפשרות 3<TAB>אפשרות 4
 *   נורית מתח	תקין	מהבהבת	לא דולקת	לא נבדק
 *
 * The text (UTF-8, already decoded by the browser) splits into lines on \r?\n; every cell is
 * trimmed, empty cells at the end of a line are dropped, and a line left without cells is skipped.
 * The first line is a header — and skipped — when its first cell is TSV_HEADER.
 *
 * Each line becomes a choice row with editorModel.NEW_FIELD_DEFAULTS:
 *   one cell     the name, with the default options — exactly the editor's added row (newField:
 *                linked to the default shared list when it exists, else artboard 2's options);
 *   two or more  the first is the name, the rest the options in order. Options that are EXACTLY a
 *                shared list (the same labels in the same order) link the field to that list
 *                (list_ref + the list's options); otherwise each option takes the tone of the first
 *                shared-list option with the same label (lists in the order given, first wins), or
 *                neutral.
 * What is too long for the shape check is cut to LIMITS (fieldLabel, optionLabel, options), so an
 * autosave is never refused for it. The lint runs on the result like on any edit (draftStore).
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
  const base = { id: ids.field(), ...NEW_FIELD_DEFAULTS, label, type: "choice_row" as const };
  const exact = exactSharedList(labels, lists);
  if (exact) return { ...base, options: exact.options.map((o) => ({ ...o })), list_ref: { id: exact.id, ver: exact.version } };
  return { ...base, options: labels.map((l) => ({ id: ids.option(), label: l, tone: sharedTone(l, lists) })) };
}

/** The pasted lines as fields, in order. */
export function tsvFields(rows: readonly TsvRow[], lists: readonly SharedListLike[] | null = null, ids: IdSource = DEFAULT_IDS): ChoiceRowField[] {
  return rows.map((r) => tsvRowField(r, lists, ids));
}
