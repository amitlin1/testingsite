/**
 * Hebrew strings shared by the station-fields module, the API and the worker popups.
 *
 * Every string is copied character for character from an artboard script
 * (route-fields handoff, design/*.dc.html) or the spec: "—" is U+2014, "·" is U+00B7,
 * quotes are the ASCII apostrophe. Where artboards word the same element differently,
 * each popup keeps its own artboard's wording (spec §4.4) — hence statusA / statusB /
 * statusC / missLabel side by side.
 *
 * Text no artboard draws lives in UNDRAWN_TEXT (spec "העיצוב סגור" rule 2; its wording was
 * approved on 2026-10-14). The admin screen keeps its own labels file.
 */

// ---- lint (spec §2.3) ---------------------------------------------------------
export const LINT_TEXT = {
  /** StationFieldEditor.dc.html — under an empty field name. */
  fieldLabelEmpty: "יש להזין שם לשדה",
  /** OptionListEditor.dc.html — validation line. */
  optionLabelEmpty: "אפשרות ריקה — מלאו או הסירו",
  optionsTooMany: "יותר מ-6 אפשרויות — קשה לבחירה מהירה",
  optionsTooFew: "נדרשות לפחות 2 אפשרויות",
  optionsNoFail: "אף אפשרות לא נחשבת 'כשל'",
} as const;

/** OptionListEditor.dc.html — the green validation line when nothing is wrong:
 *  "{n} אפשרויות · אחת נחשבת 'כשל'" / "{n} אפשרויות · {k} נחשבות 'כשל'". */
export function optionsOkText(n: number, fails: number): string {
  return n + " אפשרויות · " + (fails === 1 ? "אחת נחשבת 'כשל'" : fails + " נחשבות 'כשל'");
}

/** Main.dc.html — the map's error bar: "{station} · {item}: אפשרות ריקה בשדה '{field}'". */
export function optionEmptyMapText(station: string, item: string, field: string): string {
  return station + " · " + item + ": אפשרות ריקה בשדה '" + field + "'";
}

/** ApplyFieldSetDialog.dc.html — a set/paste row skipped because the cell already has it. */
export function duplicateSkipText(field: string, cell: string): string {
  return "שדה '" + field + "' כבר קיים ב'" + cell + "' — יידלג כדי למנוע כפילות";
}

// ---- suggestion line (spec §4.9) ------------------------------------------------
/** Artboards 12, 13, 15–18. */
export const SUGGEST_PREFIX = "מוצע: לא תקין — ";
/** Artboard 14 (`failText`). */
export const SUGGEST_PREFIX_DIALOG = "מוצע לסמן כלא תקין — ";
/** Artboard 13 — muted tail after the suggestion. */
export const SUGGEST_TAIL_WORKER_DECIDES = " · ההחלטה בידי העובד";
/** pass_fail words — PassFail (stationKit) and artboard 14. */
export const PASS_FAIL_WORD = { pass: "תקין", fail: "לא תקין" } as const;

// ---- finish gate (spec §3.4 step 6; artboard 14 `alertText`) ---------------------
// The counts below are evaluateFields' missingRequired / missingNotes lengths, which never share
// a field — so their sum is a number of fields, as every artboard counts it.

/** The gate message the server returns with 422 FIELDS_INCOMPLETE and the popups show
 *  before submitting. null when nothing is missing. */
export function fieldsGateText(missingRequired: number, missingNotes: number): string | null {
  const total = missingRequired + missingNotes;
  if (missingRequired === 0 && missingNotes === 1) return "חסרה הערה לחריגה בבדיקות העמדה — יש לפרט לפני סיום בדיקה";
  if (total === 1) return "נותר שדה חובה אחד בבדיקות העמדה — יש למלא לפני סיום בדיקה";
  if (total > 1) return "נותרו " + total + " שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה";
  return null;
}

// ---- block status lines (spec §4.4) ---------------------------------------------
/** A status line and its colour role: success → --color-success-ink,
 *  muted → --color-ink-muted-48, danger → --color-destructive. */
export type StatusLine = { text: string; tone: "success" | "muted" | "danger" };

/** Status א — artboards 12, 15, 16 (`reqLabel`). */
export function statusA(missingRequired: number, missingNotes: number): StatusLine {
  const total = missingRequired + missingNotes;
  if (total === 0) return { text: "כל שדות החובה מולאו", tone: "success" };
  return { text: missLabel(missingRequired, missingNotes), tone: "muted" };
}

/** Status ב — artboard 13: "{done} / {total} שדות חובה" while a required field is empty,
 *  then "חסרה הערה לחריגה" while only notes are missing. */
export function statusB(requiredDone: number, requiredTotal: number, missingNotes: number): StatusLine {
  const missing = requiredTotal - requiredDone;
  if (missing + missingNotes === 0) return { text: "כל שדות החובה מולאו", tone: "success" };
  if (missing > 0) return { text: requiredDone + " / " + requiredTotal + " שדות חובה", tone: "muted" };
  return { text: "חסרה הערה לחריגה", tone: "danger" };
}

/** Status ג — artboard 14: "חובה: {done} מתוך {total}" until everything (notes included) is done. */
export function statusC(requiredDone: number, requiredTotal: number, missingNotes: number): StatusLine {
  if (requiredDone === requiredTotal && missingNotes === 0) return { text: "כל שדות החובה מולאו", tone: "success" };
  return { text: "חובה: " + requiredDone + " מתוך " + requiredTotal, tone: "muted" };
}

/** Artboards 17/18 (`missLabel`) — the disabled next-button label of the close wizard, and the
 *  muted half of status א. Only meaningful when something is missing (r + n > 0). */
export function missLabel(missingRequired: number, missingNotes: number): string {
  const total = missingRequired + missingNotes;
  if (missingRequired === 0 && missingNotes === 1) return "חסרה הערה לחריגה";
  if (total === 1) return "נותר שדה חובה אחד";
  return "נותרו " + total + " שדות חובה";
}

// ---- publish dialog (artboard 10) -------------------------------------------------
/** Artboard 10 — the route under a "מה השתנה" group: "מסלול {n} של {type}" ("מסלול 1 של מחשב"). */
export function routeOfTypeLabel(routeNumber: number, itemTypeDesc: string): string {
  return "מסלול " + routeNumber + " של " + itemTypeDesc;
}
/** Artboard 10 — the same line for the kit's own route, when the dialog is opened on a kit. */
export const KIT_ROUTE_LABEL = "מסלול המארז";

// ---- not drawn in any artboard ----------------------------------------------------
/** Text the artboards never draw, worded here and approved on 2026-10-14. */
export const UNDRAWN_TEXT = {
  // OPTIONS_EMPTY — a choice field with 0 options (spec §2.3, §5.15).
  optionsEmpty: "אין אפשרויות — הוסיפו אפשרות",
  // NUMBER_RANGE — minimum above maximum / negative tolerance (spec §2.3, §5.15).
  numberRange: "טווח לא תקין",
  // DUPLICATE_LABEL_IN_CELL lint warning — same field name twice in one cell (spec §5.15).
  duplicateLabel: "שם השדה כבר קיים בתא",
  // CHECKLIST_EMPTY — a checklist field with 0 items (the item editor is not drawn, spec §5.5.2).
  checklistEmpty: "אין תיבות סימון — הוסיפו תיבת סימון",
  // CHECKLIST_ITEM_LABEL_EMPTY — a checklist item without a name (worded like LINT_TEXT.optionLabelEmpty).
  checklistItemLabelEmpty: "תיבת סימון ריקה — מלאו או הסירו",
  // STEP_SCOPE_MISMATCH — the step's station type changed level (package / item) under its fields (spec §3.5).
  stepScopeMismatch: "השדות לא תואמים לרמת העמדה",
  // STEP_UNKNOWN — the config names a step the route does not have (or the route's
  // step uids no longer line up with its steps); publish refuses it with the other errors (spec §3.4.3).
  stepUnknown: "השלב לא נמצא במסלול",
  // server 400 NOTE_TOO_LONG (spec §3.4 step 4, §10.4).
  noteTooLong: "ההערה ארוכה מהאורך המרבי",
  // server 409 FIELDS_SCHEMA_MISMATCH — the config changed while the popup was open (spec §3.4 step 2, §10.4).
  schemaMismatch: "הגדרות השדות עודכנו — יש לבדוק ולשמור שוב",
} as const;
