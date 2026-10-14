import { NOTES_MODE_LABEL } from "@/app/lib/station-fields/schema";
import type { Field } from "@/app/lib/station-fields/schema";
import { EACH_ITEM_ROW_TEXT, FIELD_TYPE_TEXT, fieldsText, listLinkText, notesModeAria, routeOptionText } from "./labels";
import { LIBRARY_COPY_PENDING } from "./libraryLabels";

/**
 * Strings of "החלת ערכת שדות" — the apply-set dialog (artboard 9, route-fields spec §5.10) — and of
 * the cell editor's "שמור כערכה…" (spec §5.5.1; its dialog is not drawn).
 *
 * Copied character for character from artboard 9's DOM and script ("·" is U+00B7, "…" is U+2026,
 * "—" is U+2014, "×" is U+00D7). The set card's line is artboard 8's (libraryLabels.setRowLine — the
 * same words), "{n} שדות" / "שדה אחד" artboard 1's (labels.fieldsText), "רשימה: {name}" artboard 2's
 * (labels.listLinkText) and "הערות: {mode}" artboard 2's (labels.notesModeAria) — imported, never
 * re-typed. A form no artboard draws lives in APPLY_SET_COPY_PENDING / SAVE_AS_SET_COPY_PENDING until
 * it is approved (spec "העיצוב סגור" rule 2, §10.4) — listed in the PR under "טקסט לאישור".
 */

// ---- not drawn in any artboard --------------------------------------------------------------
/** Drafts for text artboard 9 never draws. Do not treat as approved copy. */
export const APPLY_SET_COPY_PENDING = {
  // COPY-PENDING: the title and the primary button with a single cell — artboard 9 draws 4 cells
  // only ("החלת ערכת שדות · 4 תאים", "החל על 4 תאים"); the singular as artboard 1's "תא אחד נבחר".
  titleOne: "החלת ערכת שדות · תא אחד",
  applyOne: "החל על תא אחד",
  // COPY-PENDING: the sub-line when the cells sit at several stations (spec §5.10: "תאים בכמה עמדות
  // — לא אומת") — artboard 1's own "{n} עמדות" (a line's "מסלול {r} · {n} עמדות").
  stationsMany: (n: number) => n + " עמדות",
  // COPY-PENDING: GET /api/settings/field-sets failed while the dialog is open (the library's own
  // pending words, LIBRARY_COPY_PENDING.loadFailed, and artboard 11's "נסה שוב").
  loadFailed: LIBRARY_COPY_PENDING.loadFailed,
  retry: LIBRARY_COPY_PENDING.retry,
} as const;

// ---- the dialog (artboard 9) ----------------------------------------------------------------
export const APPLY_SET_TEXT = {
  close: "סגירה",
  /** "ערכת שדות": the search's label, and the pill input's placeholder. */
  searchLabel: "ערכת שדות",
  searchPlaceholder: "חיפוש ערכה…",
  /** role="radiogroup" aria-label. */
  groupLabel: "בחירת ערכה",
  noMatches: "אין ערכות תואמות. נסו שם אחר או פתחו את ספריית הערכות.",
  /** The preview's Tags. */
  required: "חובה",
  skip: "יידלג",
  /** "יעד" and the package-level note under its chips. */
  targetsLabel: "יעד",
  packageNote: "עמדה ברמת מארז: השדות יופיעו לעובד בשורת כל פריט בתוך כרטיס המארז.",
  /** "אופן ההחלה". */
  modeLabel: "אופן ההחלה",
  modeAdd: "הוסף לשדות הקיימים",
  modeAddSub: "שדות הערכה יתווספו אחרי השדות שכבר בתא",
  modeReplace: "החלף את השדות בתא",
  modeReplaceSub: "השדות הקיימים יוסרו ושדות הערכה יבואו במקומם",
  replaceWarning: "שדות שכבר הוגדרו בתאים שנבחרו יוחלפו בשדות הערכה",
  /** The checkbox and its two help lines (artboard 9 `linkedHelp`). */
  linked: "השאר מקושר לערכה — עדכונים יוצעו לאישור",
  linkedHelpOn: "כשהערכה תתעדכן, התאים יסומנו \"הערכה עודכנה\" ותוכלו לאשר את השינוי בכל תא.",
  linkedHelpOff: "השדות יועתקו לתאים כעותק עצמאי. שינויים בערכה לא ישפיעו עליהם.",
  /** The footer. */
  library: "ספריית הערכות",
  cancel: "ביטול",
} as const;

/** The title (artboard 9): "החלת ערכת שדות · {n} תאים"; one cell is COPY-PENDING. */
export function applyTitleText(cells: number): string {
  return cells === 1 ? APPLY_SET_COPY_PENDING.titleOne : "החלת ערכת שדות · " + cells + " תאים";
}

/** The primary button (artboard 9): "החל על {n} תאים"; one cell is COPY-PENDING. */
export function applyButtonText(cells: number): string {
  return cells === 1 ? APPLY_SET_COPY_PENDING.applyOne : "החל על " + cells + " תאים";
}

/** The sub-line (artboard 9): "{route} · עמדת {station}" — "מארז עמדת עבודה · מסלול 1 · עמדת סגירת
 *  מארז", the route as the "מסלול" combobox names it. Cells at several stations end in the
 *  COPY-PENDING "{n} עמדות". */
export function applySubText(subject: string, routeNumber: number, stations: readonly string[]): string {
  const head = routeOptionText(subject, routeNumber);
  if (stations.length === 0) return head;
  return head + " · " + (stations.length === 1 ? "עמדת " + stations[0] : APPLY_SET_COPY_PENDING.stationsMany(stations.length));
}

/** The preview's title (artboard 9 `previewTitle`): "מה יתווסף לכל תא · {set}" (add) / "מה יהיה בכל
 *  תא · {set}" (replace). */
export function previewTitleText(mode: "add" | "replace", setName: string): string {
  return (mode === "add" ? "מה יתווסף לכל תא · " : "מה יהיה בכל תא · ") + setName;
}

/** Beside it (artboard 9 `previewCount`): "{n} שדות · קריאה בלבד" ("שדה אחד · קריאה בלבד"). */
export function previewCountText(fields: number): string {
  return fieldsText(fields) + " · קריאה בלבד";
}

/**
 * A preview row's meta (artboard 9 `meta`): "רשימה: {list} · הערות: {mode}" — the list only for a
 * field linked to a shared list ("הערות: חובה בכשל" alone otherwise). A field that is not a "שורת
 * בדיקה" starts with its type's name (artboard 3's picker names — "מספר · הערות: אופציונלי"; the
 * artboard draws choice rows only). `listName` null = a linked list whose name is not known yet.
 */
export function fieldMetaText(field: Exclude<Field, { type: "section" }>, listName: string | null): string {
  const parts: string[] = [];
  if (field.type !== "choice_row") parts.push(FIELD_TYPE_TEXT[field.type].name);
  if ((field.type === "choice_row" || field.type === "multi_choice") && field.list_ref) parts.push(listLinkText(true, listName));
  parts.push(notesModeAria(NOTES_MODE_LABEL[field.notes]));
  return parts.join(" · ");
}

/** The duplicate line (artboard 9): "שדה '{f}' כבר קיים ב'{place}' — יידלג כדי למנוע כפילות". */
export function duplicateLineText(field: string, place: string): string {
  return "שדה '" + field + "' כבר קיים ב'" + place + "' — יידלג כדי למנוע כפילות";
}

/** The place of a duplicate held by the step's each_item group: artboard 9's 'כל פריט במארז'. */
export const EACH_ITEM_PLACE = EACH_ITEM_ROW_TEXT.title;

/** A "יעד" chip (artboard 9): "{station} · {seq} {item}[ ×{qty}]" — "סגירת מארז · 02–03 מסך ×2". The
 *  dialog draws the seq and the quantity muted; this is the chip's whole text (a duplicate line's
 *  place). */
export function targetChipText(station: string, seq: string, item: string, qty: string): string {
  return station + " · " + (seq ? seq + " " : "") + item + (qty ? " " + qty : "");
}

// ---- "שמור כערכה…" (the cell editor's ⋯, spec §5.5.1) ---------------------------------------
/** Its dialog is not drawn (spec §5.5.1, §10.4 "דיאלוגים: … 'שמור כערכה…'"). Do not treat as approved
 *  copy. */
export const SAVE_AS_SET_COPY_PENDING = {
  // COPY-PENDING: the dialog's title and its confirm button — artboard 8's "שמירה כגרסה {v}" with
  // the action of the menu item.
  title: "שמירה כערכה",
  confirm: "שמירה כערכה",
  cancel: "ביטול",
  // COPY-PENDING: the name input — artboard 8's "שינוי שם הערכה" names the same thing.
  nameLabel: "שם הערכה",
  // COPY-PENDING: what the save does: a copy of the cell's fields in the library; the cell keeps its
  // own (it is not linked to the new set).
  help: "השדות של התא יועתקו לערכה חדשה בספריית הערכות. התא עצמו לא ישתנה.",
  // COPY-PENDING: POST /api/settings/field-sets failed — the library's own pending word.
  failed: LIBRARY_COPY_PENDING.createFailed,
  // COPY-PENDING: the message after the set was created.
  savedPrefix: "הערכה '",
  savedSuffix: "' נשמרה בספריית הערכות",
} as const;

/** The message after "שמור כערכה…" (COPY-PENDING): "הערכה '{name}' נשמרה בספריית הערכות". */
export function savedAsSetText(name: string): string {
  return SAVE_AS_SET_COPY_PENDING.savedPrefix + name + SAVE_AS_SET_COPY_PENDING.savedSuffix;
}
