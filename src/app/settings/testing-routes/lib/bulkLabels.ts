import { UNDRAWN_TEXT, EDITOR_UNDRAWN_TEXT } from "./labels";

/**
 * Strings of the map's multi-select actions and of "הדבק מאקסל" (route-fields spec §5.4.4, §5.14;
 * artboards 1 and 2). The selection bar's drawn words (BULK_TEXT, selectedCellsText) live in
 * labels.ts; this module holds what no artboard draws — the confirm of "נקה", the message after a
 * copy or a paste (spec §10.4: "Snackbar אחרי … הדבקה"), and the fallback when the clipboard cannot
 * be read. Every entry here is undrawn; its wording was approved on 2026-10-14.
 */

/** Artboard 2's "הדבק מאקסל" button and its title (spec §5.5.2 ד). Drawn — not pending. */
export const PASTE_TSV_TEXT = {
  button: "הדבק מאקסל",
  title: "הדביקו שורות: שם⇥אפשרות 1⇥אפשרות 2⇥…",
  /** The selection bar's key hint beside "הדבק" (artboard 1), read left to right. */
  pasteKeys: "Ctrl V",
} as const;

export const BULK_UNDRAWN_TEXT = {
  // the confirm of the selection bar's "נקה" (spec §5.14 "אישור לא מצויר", §10.4
  // "אישורים: … 'נקה'"). One cell reuses the editor's own (EDITOR_UNDRAWN_TEXT.clear*); the cancel
  // button the discard confirm's "המשך לערוך".
  clearTitleMany: (n: number) => "לנקות " + n + " תאים?",
  clearMessageMany: (n: number) => "כל השדות של " + n + " התאים יוסרו מהטיוטה. ביטול הטיוטה מחזיר אותם.",
  clearCancel: UNDRAWN_TEXT.discardCancel,
  // the message after "העתק" / Ctrl C (no artboard draws one).
  copiedOne: "התא הועתק",
  copiedMany: (n: number) => n + " תאים הועתקו",
  // the message after "הדבק" / Ctrl V / "הדבק מאקסל" (spec §5.14 "ההודעה אחרי הדבקה לא
  // מצוירת"). The skip wording follows artboard 9's "יידלג כדי למנוע כפילות".
  addedOne: "נוסף שדה אחד",
  addedMany: (n: number) => "נוספו " + n + " שדות",
  addedNone: "לא נוספו שדות",
  inCells: (n: number) => "ב-" + n + " תאים",
  skippedOne: "שדה אחד דולג כדי למנוע כפילות",
  skippedMany: (n: number) => n + " שדות דולגו כדי למנוע כפילות",
  overflowOne: "שדה אחד לא נוסף: בתא אין מקום לשדות נוספים",
  overflowMany: (n: number) => n + " שדות לא נוספו: בתא אין מקום לשדות נוספים",
  outsideOne: "תא אחד לא במסלול",
  outsideMany: (n: number) => n + " תאים לא במסלול",
  nothingToPaste: "אין מה להדביק",
  // the paste box when the system clipboard cannot be read — no permission, or a page
  // served over plain http, where the browser offers no clipboard API (spec §5.14).
  pasteBoxTitle: "הדבקה",
  pasteBoxHelp: "הדביקו כאן (Ctrl V) את השורות שהעתקתם. שורה לכל שדה: שם⇥אפשרות 1⇥אפשרות 2⇥…",
  pasteBoxLabel: "שורות להדבקה",
  pasteBoxCancel: "ביטול",
  pasteBoxConfirm: "הדבק",
} as const;

/** The title of the selection bar's "נקה" confirm. */
export function clearCellsTitle(n: number): string {
  return n === 1 ? EDITOR_UNDRAWN_TEXT.clearTitle : BULK_UNDRAWN_TEXT.clearTitleMany(n);
}

/** The body of the selection bar's "נקה" confirm. */
export function clearCellsMessage(n: number): string {
  return n === 1 ? EDITOR_UNDRAWN_TEXT.clearMessage : BULK_UNDRAWN_TEXT.clearMessageMany(n);
}

/** After a copy (undrawn). */
export function copiedText(cells: number): string {
  return cells === 1 ? BULK_UNDRAWN_TEXT.copiedOne : BULK_UNDRAWN_TEXT.copiedMany(cells);
}

export type PasteCountsLike = {
  /** Cells that took at least one field. */
  cells: number;
  /** Input fields added (section headers do not count). */
  added: number;
  /** Fields left out: the cell already has their name. */
  skipped: number;
  /** Fields left out: the cell's list is full. */
  overflow: number;
  /** Cells of a copied shape that landed on "—" or outside the map. */
  outside: number;
};

/** After a paste (undrawn): "נוספו 6 שדות ב-3 תאים · שדה אחד דולג כדי למנוע כפילות". */
export function pastedText(c: PasteCountsLike): string {
  const C = BULK_UNDRAWN_TEXT;
  let head: string = c.added === 0 ? C.addedNone : c.added === 1 ? C.addedOne : C.addedMany(c.added);
  if (c.added > 0 && c.cells > 1) head += " " + C.inCells(c.cells);
  const parts = [head];
  if (c.skipped > 0) parts.push(c.skipped === 1 ? C.skippedOne : C.skippedMany(c.skipped));
  if (c.overflow > 0) parts.push(c.overflow === 1 ? C.overflowOne : C.overflowMany(c.overflow));
  if (c.outside > 0) parts.push(c.outside === 1 ? C.outsideOne : C.outsideMany(c.outside));
  return parts.join(" · ");
}
