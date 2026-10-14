import { TONE_WORD } from "@/app/lib/station-fields/schema";
import type { Tone } from "@/app/lib/station-fields/schema";
import { COPY_PENDING as SCREEN_COPY_PENDING, fieldsText } from "./labels";

/**
 * Strings of "ערכות ורשימות" — the field sets and option lists library (artboard 8, spec §5.9) — and
 * of the shared mode of the options popover (artboard 4, spec §5.7). Session 2d keeps them here so
 * lib/labels.ts stays the map's and the editor's.
 *
 * Copied character for character from the artboard scripts and DOM ("·" is U+00B7, "…" is U+2026,
 * "›" is U+203A, "—" is U+2014). Each count keeps the singular/plural rule of the artboard script
 * that draws it. A form no artboard draws lives in LIBRARY_COPY_PENDING until it is approved (spec
 * "העיצוב סגור" rule 2, §10.4) — listed in the PR under "טקסט לאישור".
 */

// ---- not drawn in any artboard --------------------------------------------------------------
/** Drafts for library text the artboards never draw. Do not treat as approved copy. */
export const LIBRARY_COPY_PENDING = {
  // COPY-PENDING: relative times of the set meta line. Artboard 8 draws "עכשיו" ("עודכנה עכשיו",
  // "נוצרה עכשיו") and "לפני יומיים"; the other spans are worded like the header's pending
  // "נשמר אוטומטית לפני …" (lib/labels.ts COPY_PENDING.saved*).
  agoMinute: "לפני דקה",
  agoPrefix: "לפני ",
  agoMinutesSuffix: " דקות",
  agoHour: "לפני שעה",
  agoHoursSuffix: " שעות",
  agoDay: "לפני יום",
  agoDaysSuffix: " ימים",
  // COPY-PENDING: singulars the artboards never draw — a list of one option, a list linked to one
  // field, a change that reaches one route (artboards 4 and 8 draw "{n} אפשרויות", "בשימוש ב-{n}
  // שדות", "ב-{R} מסלולים" with n ≥ 2). Worded like artboard 8's "בשימוש בתא אחד".
  optionsOne: "אפשרות אחת",
  usedInFieldsOne: "בשימוש בשדה אחד",
  inRoutesOne: " במסלול אחד",
  // COPY-PENDING: "שכפל" on an option list (spec §5.9 lists the button, its result is not drawn): the
  // copy is named like artboard 8's duplicated set, "{name} · עותק".
  copySuffix: " · עותק",
  // COPY-PENDING: the delete confirms (spec §5.9: "אישור לא מצויר"). The confirm button is the
  // drawn "מחק"; ConfirmDialog's own "ביטול" cancels.
  deleteSetTitle: "למחוק את הערכה?",
  deleteSetMessage: "הערכה תוסר מהספרייה. תאים שהשדות שלה כבר הועתקו אליהם לא ישתנו.",
  deleteListTitle: "למחוק את הרשימה?",
  deleteListMessage: "הרשימה תוסר מהספרייה.",
  // COPY-PENDING: DELETE answered 409 IN_USE (spec §3.2 / §5.9: "טקסט ההודעה לא מצויר").
  setInUse: "אי אפשר למחוק ערכה שמוחלת על תאים. הסירו אותה מהתאים במפת השדות ונסו שוב.",
  listInUse: "אי אפשר למחוק רשימה שמקושרת לשדות. נתקו אותה מהשדות ונסו שוב.",
  // COPY-PENDING: a library write that failed (network, 5xx, a refusal). The retry button reuses
  // artboard 11's "נסה שוב".
  saveFailed: "השמירה נכשלה",
  createFailed: "היצירה נכשלה",
  deleteFailed: "המחיקה נכשלה",
  updateFailed: "העדכון נכשל",
  retry: SCREEN_COPY_PENDING.saveRetry,
  // COPY-PENDING: PUT answered 409 VERSION_CONFLICT — the set / list was saved elsewhere meanwhile
  // (worded like the draft conflict, lib/labels.ts COPY_PENDING.conflict). The action reloads it.
  setConflict: "הערכה עודכנה בינתיים במקום אחר — יש לטעון אותה מחדש",
  listConflict: "הרשימה עודכנה בינתיים במקום אחר — יש לטעון אותה מחדש",
  conflictReload: SCREEN_COPY_PENDING.conflictReload,
  // COPY-PENDING: GET /api/settings/field-sets or /option-lists failed — the library is never shown
  // as empty then (artboard 11's rule for the map). "נסה שוב" as artboard 11.
  loadFailed: "טעינת הספרייה נכשלה",
  // COPY-PENDING: GET …/field-sets/[id]/usage failed.
  usageFailed: "טעינת התאים שמשתמשים בערכה נכשלה",
  // COPY-PENDING: the options popover opened from the library (no field to apply to): its primary
  // button for a NEW list — artboard 4's footer words without the ellipsis (the name is typed in the
  // popover itself). An existing list saves with artboard 8's "שמירה כגרסה {v+1}".
  saveAsNewList: "שמור כרשימה חדשה",
} as const;

// ---- counts (artboard 8 script) ---------------------------------------------------------------
/** Artboard 8 `fieldsTxt`: "ללא שדות" / "שדה אחד" / "{n} שדות". */
export function setFieldsText(n: number): string {
  return n === 0 ? "ללא שדות" : fieldsText(n);
}

/** Artboard 8 `cellsTxt`: "בשימוש בתא אחד" / "בשימוש ב-{n} תאים". */
export function usedInCellsText(n: number): string {
  return n === 1 ? "בשימוש בתא אחד" : "בשימוש ב-" + n + " תאים";
}

/** "{n} אפשרויות" (artboards 4, 8); one option is COPY-PENDING. */
export function optionsText(n: number): string {
  return n === 1 ? LIBRARY_COPY_PENDING.optionsOne : n + " אפשרויות";
}

/** "בשימוש ב-{n} שדות" (artboards 4, 8); one field is COPY-PENDING. */
export function usedInFieldsText(n: number): string {
  return n === 1 ? LIBRARY_COPY_PENDING.usedInFieldsOne : "בשימוש ב-" + n + " שדות";
}

// ---- the library pane (artboard 8, the list) ---------------------------------------------------
export const LIBRARY_TEXT = {
  /** <section aria-label> of the list pane, and the segmented control's group. */
  paneLabel: "ספריית ערכות ורשימות",
  segGroupLabel: "תוכן הספרייה",
  setsTitle: "ערכות שדות",
  listsTitle: "רשימות אפשרויות",
  newSet: "ערכה חדשה",
  newList: "רשימה חדשה",
  searchSets: "חיפוש ערכה…",
  searchLists: "חיפוש רשימה…",
  noResults: "אין תוצאות",
  noSets: "אין ערכה בשם הזה. אפשר ליצור ערכה חדשה.",
  noLists: "אין רשימה בשם הזה.",
  setsFoot: "ערכה היא תבנית: החלה על תא מעתיקה את השדות ושומרת קישור, כדי שעדכונים יוצעו לתא.",
  listsFoot: "רשימה משותפת מקושרת לשדות: שינוי באפשרויות יחול על כל השדות שמשתמשים בה אחרי פרסום.",
  unsaved: "שינויים שלא נשמרו",
  unused: "לא בשימוש",
  /** The name a "+ ערכה חדשה" set starts with (artboard 8 `addSet`). */
  newSetName: "ערכה חדשה",
  /** A list whose name is still empty (artboard 4 script). */
  unnamedList: "רשימה ללא שם",
  /** The meta line's leads (artboard 8 `meta`). */
  updated: "עודכנה ",
  created: "נוצרה ",
  duplicatedFrom: "שוכפלה מ: ",
  now: "עכשיו",
  twoDaysAgo: "לפני יומיים",
  /** The set's actions (artboard 8 DOM); "החל על תאים…" leads to artboard 9. */
  duplicate: "שכפל",
  remove: "מחק",
  applyToCells: "החל על תאים…",
  renameSet: "שינוי שם הערכה",
  renameList: "שינוי שם הרשימה",
  /** The usage block. */
  usageHint: "לחיצה על תא פותחת אותו בעורך",
  usageNone: "הערכה עוד לא מוחלת על אף תא. בחרו תאים במפת השדות ולחצו \"החל ערכת שדות…\", או השתמשו בכפתור \"החל על תאים…\" למעלה.",
  /** The outdated bar. */
  outdatedNote: "השדות בתאים האלה נשארים כמו שהם עד שתאשרו את העדכון ותפרסמו.",
  /** The fields block. */
  fieldsNote: "אותה שורה כמו בעורך העמדה: שם · 4 אפשרויות · הערות · חובה",
  openListTitle: "פתיחת הרשימה בלשונית רשימות אפשרויות",
  emptySetTitle: "אין עדיין שדות בערכה",
  emptySetBody: "התחילו בשורת בדיקה: שם, 4 אפשרויות לבחירה מהירה והערות.",
  footUsed: "עדכון הערכה יוצע לאישור בכל תא מקושר; שום תא לא משתנה בלי פרסום.",
  footUnused: "כשהערכה תוחל על תאים, כל עדכון שלה יוצע לאישור בתאים המקושרים.",
} as const;

/** The segmented control (artboard 8 `segSets` / `segLists`). */
export function setsSegText(n: number): string {
  return "ערכות שדות · " + n;
}
export function listsSegText(n: number): string {
  return "רשימות אפשרויות · " + n;
}

/** A set row's second line (artboard 8): "{N} שדות · בשימוש ב-{n} תאים"; unused "{N} שדות". */
export function setRowLine(fields: number, cells: number): string {
  return cells > 0 ? setFieldsText(fields) + " · " + usedInCellsText(cells) : setFieldsText(fields);
}

/** A list row's second line (artboard 8): "{n} אפשרויות · בשימוש ב-{m} שדות". A list linked to no
 *  field (not drawn) shows its options only, as an unused set does. */
export function listRowLine(options: number, fields: number): string {
  return fields > 0 ? optionsText(options) + " · " + usedInFieldsText(fields) : optionsText(options);
}

// ---- the set editor (artboard 8) ---------------------------------------------------------------
/** <section aria-label> of the editor pane (artboard 8 `editorAria`). */
export function setEditorLabel(name: string): string {
  return "עריכת ערכה: " + name;
}
export function listDetailLabel(name: string): string {
  return "רשימת אפשרויות: " + name;
}

/** The version Tag and the outdated chip (artboard 8): "גרסה {v}". */
export function versionText(v: number): string {
  return "גרסה " + v;
}

/** Artboard 8 `dirtyText`: "שינויים שלא נשמרו · יישמרו כגרסה {v+1}". */
export function unsavedVersionText(nextVersion: number): string {
  return "שינויים שלא נשמרו · יישמרו כגרסה " + nextVersion;
}

/** Artboard 8 `saveText`: "שמירה כגרסה {v+1}". */
export function saveAsVersionText(nextVersion: number): string {
  return "שמירה כגרסה " + nextVersion;
}

/** Artboard 8 `addSet(base)`: "{name} · עותק". */
export function copyNameText(name: string): string {
  return name + LIBRARY_COPY_PENDING.copySuffix;
}

/** A usage chip's accessible name (artboard 8 `aria`): "{full}[ · גרסה {n}]". */
export function usageChipLabel(full: string, oldVersion: number | null): string {
  return oldVersion != null ? full + " · " + versionText(oldVersion) : full;
}

/** Artboard 8 `moreText`: "+{n} נוספים". */
export function moreUsesText(n: number): string {
  return "+" + n + " נוספים";
}

/** Artboard 8 `outdatedText`. */
export function outdatedText(n: number): string {
  return n === 1 ? "תא אחד משתמש בגרסה קודמת של הערכה" : n + " תאים משתמשים בגרסה קודמת של הערכה";
}

/** Artboard 8 `updateAllText`: "עדכן את כולם ({n})". */
export function updateAllText(n: number): string {
  return "עדכן את כולם (" + n + ")";
}

/** Artboard 8 `fieldsTitle`: "שדות בערכה · {n}". */
export function setFieldsTitle(n: number): string {
  return "שדות בערכה · " + n;
}

/** Artboard 8 `footStats`: "{N} שדות · {M} חובה". */
export function setFootStats(fields: number, required: number): string {
  return setFieldsText(fields) + " · " + required + " חובה";
}

// ---- the list detail (artboard 8, "פרטי רשימה") --------------------------------------------------
export const LIST_DETAIL_TEXT = {
  sharedTag: "רשימה משותפת",
  editOptions: "עריכת האפשרויות",
  keysNote: "המספר הוא מקש הבחירה המהירה בחלון העובד",
  optionsLabel: "אפשרויות הרשימה",
  verdictTitle: "איך כל אפשרות נספרת בפסק הדין",
  noLabels: "—",
  verdictNote: "בחירה מסוג כשל מציעה \"לא תקין\" בפסק הדין של העמדה; העובד יכול לשנות זאת עם הערה.",
  workerTitle: "כך העובד יראה את הרשימה",
  workerPlaceholder: "בחר…",
  inSetsTitle: "בערכות שדות",
  inSetsHint: "לחיצה פותחת את הערכה",
  inSetsNone: "אף ערכת שדות לא משתמשת ברשימה הזו. היא מקושרת ישירות לשדות במסלולים.",
  footnote: "שמות האפשרויות נשמרים בתוצאה ברגע השמירה, כך ששינוי שם לא משנה תוצאות שכבר נשמרו.",
} as const;

/** Artboard 8 `list.meta`: "בשימוש ב-{N} שדות · {M} אפשרויות". */
export function listMetaText(fields: number, options: number): string {
  return usedInFieldsText(fields) + " · " + optionsText(options);
}

/** Artboard 8 `optsTitle`: "אפשרויות · {n}". */
export function listOptionsTitle(n: number): string {
  return "אפשרויות · " + n;
}

/** An option chip's accessible name (artboard 8 `aria`): "{key} · {label} · {tone word}". */
export function listOptionLabel(key: string, label: string, tone: Tone): string {
  return key + " · " + label + " · " + TONE_WORD[tone];
}

/** Artboard 8 `failTxt`. */
export function failCountText(fails: number): string {
  if (fails === 0) return "אף אחת לא נחשבת 'כשל'";
  return fails === 1 ? "אחת נחשבת 'כשל'" : fails + " נחשבות 'כשל'";
}

/** Artboard 8 `summary`: "{n} אפשרויות · {failTxt}". */
export function listSummaryText(options: number, fails: number): string {
  return optionsText(options) + " · " + failCountText(fails);
}

/** A set chip's line under "בערכות שדות" (artboard 8 `inSets.line`): "שדה אחד" / "{n} שדות". */
export function setUsesListText(n: number): string {
  return fieldsText(n);
}

/** Artboard 8 `list.alert`: "שינוי ברשימה המשותפת יחול על {N} שדות לאחר פרסום. תוצאות שכבר נשמרו
 *  לא ישתנו." (one field: artboard 1's "שדה אחד"). */
export function listAlertText(fields: number): string {
  return "שינוי ברשימה המשותפת יחול על " + fieldsText(fields) + " לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.";
}

// ---- the options popover in shared mode (artboard 4, spec §5.7) ---------------------------------------
export const SHARED_LIST_TEXT = {
  searchLabel: "חיפוש רשימה",
  searchPlaceholder: "חיפוש רשימה…",
  colLists: "רשימות משותפות",
  colFields: "שדות",
  groupLabel: "רשימות משותפות",
  noMatch: "אין רשימות תואמות",
  newList: "רשימה חדשה",
  nameLabel: "שם הרשימה",
  saveAsNew: "שמור כרשימה חדשה…",
} as const;

/** A list row's accessible name (artboard 4 `aria`): "{name} · בשימוש ב-{n} שדות". */
export function sharedListRowLabel(name: string, fields: number): string {
  return name + " · " + usedInFieldsText(fields);
}

/** The Link2 title on the row of the list the field is linked to (artboard 4). */
export function linkedToFieldTitle(field: string): string {
  return "מקושר לשדה " + field;
}

/** "שם הרשימה"'s help (artboard 4 `linkNote`). */
export function linkedHelpText(version: number): string {
  return "מקושר לשדה הזה · גרסה " + version;
}
export function willLinkHelpText(field: string): string {
  return "בלחיצה על \"החל על השדה\" " + field + " תקושר לרשימה הזו";
}

/** The impact note (artboard 4 `impact`): "שינוי ברשימה המשותפת יחול על {N} שדות[ ב-{R} מסלולים] לאחר
 *  פרסום. תוצאות שכבר נשמרו לא ישתנו." — the routes part only when R > 0, as the script has it. */
export function sharedImpactText(fields: number, routes: number): string {
  const r = routes <= 0 ? "" : routes === 1 ? LIBRARY_COPY_PENDING.inRoutesOne : " ב-" + routes + " מסלולים";
  return "שינוי ברשימה המשותפת יחול על " + fieldsText(fields) + r + " לאחר פרסום. תוצאות שכבר נשמרו לא ישתנו.";
}

/** Local mode's box title (artboard 4): "אפשרויות מקומיות · {station} · {item}" — in the library the
 *  parts are the set's name only. */
export function localOptionsTitleOf(parts: readonly string[]): string {
  return ["אפשרויות מקומיות", ...parts.filter((p) => p.trim() !== "")].join(" · ");
}
