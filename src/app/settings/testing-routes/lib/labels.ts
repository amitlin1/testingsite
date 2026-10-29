import { optionEmptyMapText } from "@/app/lib/station-fields/labels";
import { TONE_WORD } from "@/app/lib/station-fields/schema";
import type { FieldType, Tone } from "@/app/lib/station-fields/schema";
import type { Issue } from "@/app/lib/station-fields/validate";

/**
 * Strings of the admin screen "מסלולי בדיקה" (route-fields spec §5). Lint messages, gate texts and
 * everything the worker popups or the API share live in src/app/lib/station-fields/labels.ts:
 * import them from there, never re-type them here.
 *
 * Copied character for character from the artboard scripts and DOM ("·" is U+00B7, "–" is U+2013,
 * "—" is U+2014, "×" is U+00D7). Each count keeps the singular/plural rule of the artboard script
 * that draws it (`n === 1 ? 'שדה אחד' : n + ' שדות'`). A form no artboard draws (a singular, a
 * second error, a save that failed) lives in UNDRAWN_TEXT (spec "העיצוב סגור"
 * rule 2, §10.4; wording approved on 2026-10-14).
 */

// ---- not drawn in any artboard --------------------------------------------------------------
/** Text the admin artboards never draw, worded here and approved on 2026-10-14. */
export const UNDRAWN_TEXT = {
  // the header count for a single route — artboards 1–11 draw "14 מסלולים" only.
  routesOne: "מסלול אחד",
  // the context card's kit tag with a single item type / a single unit — artboards 1
  // and 11 draw "{k} סוגי פריטים · {u} יחידות" with k, u ≥ 3.
  kitKindsOne: "סוג פריט אחד",
  kitUnitsOne: "יחידה אחת",
  // a map row whose route has a single station — artboards 1 and 11 draw
  // "מסלול {r} · {n} עמדות" with n ≥ 3.
  stationsOne: "עמדה אחת",
  // the header pill of a published route without a draft (spec §5.2 table, from the
  // old spec — no artboard draws it). Dot --color-status-approved.
  publishedPrefix: "מפורסם · גרסה ",
  // the header while an autosave is in flight and nothing was saved yet (spec §5.2:
  // the artboards draw only "נשמר אוטומטית לפני רגע").
  saving: "שומר…",
  // "נשמר אוטומטית לפני רגע" as a relative time once a minute has passed (spec §5.2
  // "מתעדכן כזמן יחסי"; the artboards draw only "לפני רגע").
  savedAgoPrefix: "נשמר אוטומטית לפני ",
  savedMinuteAgo: "נשמר אוטומטית לפני דקה",
  savedMinutesAgoSuffix: " דקות",
  savedHourAgo: "נשמר אוטומטית לפני שעה",
  savedHoursAgoSuffix: " שעות",
  savedDayAgo: "נשמר אוטומטית לפני יום",
  // two days: artboard 8's "לפני יומיים" (the set meta line, libraryLabels LIBRARY_TEXT.twoDaysAgo).
  savedTwoDaysAgo: "נשמר אוטומטית לפני יומיים",
  savedDaysAgoSuffix: " ימים",
  // an autosave (PUT …/fields/draft) or a discard (DELETE) that failed — network or
  // 5xx (spec §3.2 "שמירה נכשלה", §5.2, §10.4). The retry button reuses artboard 11's "נסה שוב".
  saveFailed: "השמירה האוטומטית נכשלה",
  saveRetry: "נסה שוב",
  // 409 DRAFT_CONFLICT — the draft changed since this screen loaded it (another tab
  // or another admin; spec §5.2, §10.4). The action reloads the route from the server.
  conflict: "הטיוטה עודכנה בינתיים במקום אחר — יש לטעון אותה מחדש",
  conflictReload: "טען מחדש",
  // the ConfirmDialog of "ביטול הטיוטה" (spec §5.2: "הטקסט שלו לא מצויר"). The
  // confirm button repeats the header button; ConfirmDialog's default "ביטול" would read as the
  // same action, hence a cancel text of its own.
  discardTitle: "לבטל את הטיוטה?",
  discardMessage: "כל השינויים שלא פורסמו יימחקו, וכל המסלולים במפה יחזרו לגרסה המפורסמת.",
  discardConfirm: "ביטול הטיוטה",
  discardCancel: "המשך לערוך",
  // a cell with more than one error — artboard 1 draws "שגיאה אחת" only (spec §5.4.3,
  // §10.4 "{n} שגיאות בתא"); also the map footer's error count.
  errorsSuffix: " שגיאות",
  // the map footer with a single empty cell / a single shared field — artboards 1 and
  // 11 draw "{n} תאים ללא שדות" and "{n} שדות משותפים" with n ≥ 5.
  emptyCellsOne: "תא אחד ללא שדות",
  sharedFieldsOne: "שדה משותף אחד",
  // artboard 11's info bar with a single filled shared cell (drawn with 3).
  sharedFilledOne: "תא אחד כבר מלא",
  // a single-item route's map (kind "item", spec §5.4.1 "לא אומת"): a package-level
  // step's fields live on the kit's route, so its cell is "—" with this tooltip.
  packageLevelOnItemRoute: "השדות של עמדה ברמת מארז מוגדרים במפת המארז",
  // a number setting (מינימום / מקסימום / ערך ייחוס / סטייה מותרת ±%) holding text that
  // is not a number (spec §5.15 "ערך לא מספרי", not drawn) — the worker's own words for the same
  // case under a number field (artboards 14 and 6, RANGE_WORD.nan in src/app/testing/fields/labels.ts).
  numberNotNumeric: "יש להזין מספר",
  // the number row's summary when only a reference ± tolerance limits the value
  // (artboard 3's `rangeShort` knows min / max only and would read "ללא טווח"): "ייחוס {ref} ±{tol}%",
  // in the word of the worker's own (undrawn) reference line, WORKER_UNDRAWN_TEXT.rangeRef.
  numberRefShort: "ייחוס",
  // the note of local options copied from a shared list whose name this screen does
  // not hold yet (the option-lists API arrives in session 2d). Artboard 4 draws the named form
  // 'הועתקו מהרשימה "{list}".' — localOptionsNote uses it as soon as the name is known.
  optionsCopiedFromSharedList: "הועתקו מהרשימה המשותפת.",
} as const;

// ---- counts -----------------------------------------------------------------------------------
/** Artboards 1, 2, 11 (`label`): "שדה אחד" / "{n} שדות". */
export function fieldsText(n: number): string {
  return n === 1 ? "שדה אחד" : n + " שדות";
}

/** Artboard 1 (`selLabel`): "תא אחד נבחר" / "{n} תאים נבחרו". */
export function selectedCellsText(n: number): string {
  return n === 1 ? "תא אחד נבחר" : n + " תאים נבחרו";
}

/** Artboard 10 (`count`): "שינוי אחד" / "{n} שינויים". */
export function changesText(n: number): string {
  return n === 1 ? "שינוי אחד" : n + " שינויים";
}

/** The header's draft pill, artboards 1–4, 7–10 (`draftLabel`): "טיוטה · {n} שינויים". Artboard 2
 *  writes the plural for every n; the singular takes artboard 10's "שינוי אחד". */
export function draftPillText(changes: number): string {
  return "טיוטה · " + changesText(changes);
}

/** The header's warning pill in place of "פרסום לעמדות", artboard 2 (`issueLabel`):
 *  "בעיה אחת לתיקון" / "{n} בעיות לתיקון". */
export function issuesToFixText(n: number): string {
  return n === 1 ? "בעיה אחת לתיקון" : n + " בעיות לתיקון";
}

/** The header count beside "מסלולי בדיקה", artboards 1–11: "{n} מסלולים". */
export function routesCountText(n: number): string {
  return n === 1 ? UNDRAWN_TEXT.routesOne : n + " מסלולים";
}

/** The context card's count tag, artboards 1, 11: "כיסוי {defined}/{relevant}". */
export function coverageText(defined: number, relevant: number): string {
  return "כיסוי " + defined + "/" + relevant;
}

/** The context card's kit tag, artboards 1, 11: "מארז · {k} סוגי פריטים · {u} יחידות". */
export function kitSummaryText(kinds: number, units: number): string {
  const k = kinds === 1 ? UNDRAWN_TEXT.kitKindsOne : kinds + " סוגי פריטים";
  const u = units === 1 ? UNDRAWN_TEXT.kitUnitsOne : units + " יחידות";
  return "מארז · " + k + " · " + u;
}

/** The header pill of a published route without a draft — undrawn (spec §5.2). */
export function publishedPillText(version: number): string {
  return UNDRAWN_TEXT.publishedPrefix + version;
}

// ---- header -------------------------------------------------------------------------------------
/** The page header (spec §5.1, §5.2; artboards 1, 11). */
export const HEADER_TEXT = {
  title: "מסלולי בדיקה",
  subtitle: "הגדרת סדר העמדות והשדות שהעובד ממלא בכל עמדה, לכל סוג מארז ולפריטים שבו.",
  /** Artboard 11: the pill when no route of the map holds a field. */
  noFields: "ללא שדות",
  /** Artboard 11: beside the disabled publish button (its aria-describedby). */
  nothingToPublish: "אין שינויים לפרסום",
  discardDraft: "ביטול הטיוטה",
  publish: "פרסום לעמדות",
} as const;

/** Artboards 1–10: "נשמר אוטומטית לפני רגע". */
export const SAVED_JUST_NOW = "נשמר אוטומטית לפני רגע";

/** The header's save time as a relative time (spec §5.2). Under a minute it is the artboards'
 *  "נשמר אוטומטית לפני רגע"; later ones are undrawn. A time in the future (clock skew between
 *  the server's draft_updated_at and this browser) reads as just now. */
export function savedAgoText(savedAtMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - savedAtMs) / 60_000);
  if (minutes < 1) return SAVED_JUST_NOW;
  if (minutes === 1) return UNDRAWN_TEXT.savedMinuteAgo;
  if (minutes < 60) return UNDRAWN_TEXT.savedAgoPrefix + minutes + UNDRAWN_TEXT.savedMinutesAgoSuffix;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return UNDRAWN_TEXT.savedHourAgo;
  if (hours < 24) return UNDRAWN_TEXT.savedAgoPrefix + hours + UNDRAWN_TEXT.savedHoursAgoSuffix;
  const days = Math.floor(hours / 24);
  if (days === 1) return UNDRAWN_TEXT.savedDayAgo;
  if (days === 2) return UNDRAWN_TEXT.savedTwoDaysAgo;
  return UNDRAWN_TEXT.savedAgoPrefix + days + UNDRAWN_TEXT.savedDaysAgoSuffix;
}

// ---- view tabs and context card -----------------------------------------------------------------
/** Spec §5.2: the `<nav aria-label="תצוגות">` tabs (artboard 1). */
export const VIEW_TAB_TEXT = {
  navLabel: "תצוגות",
  map: "מפת שדות",
  steps: "שלבי המסלול",
  library: "ערכות ורשימות",
  report: "דוח PDF",
} as const;

/** Spec §5.2: the context card (artboards 1, 11). */
export const CONTEXT_CARD_TEXT = {
  sectionLabel: "מסלול נבחר",
  openPackages: "פתח במסך המארזים",
  shortcuts: "קיצורי מקלדת",
} as const;

/**
 * Choosing a route (2026-10-26, Amit): the context card picks a package type, then one of its route
 * numbers — an item type is never picked there; "שלבי המסלול" then picks the box itself or one of
 * the items of its template. No artboard draws any of this: worded here, not yet approved.
 */
export const ROUTE_PICK_TEXT = {
  typeLabel: "סוג מארז",
  typePlaceholder: "בחר סוג מארז…",
  routeLabel: "מספר מסלול",
  routePlaceholder: "בחר מסלול…",
  /** A package type's subtitle in the list while it has no route. */
  noRoutes: "אין מסלול עדיין",
  /** A route number's subtitle: the package type's default_route_number. */
  defaultRoute: "ברירת מחדל",
  /** The subtitle of the number without a route, offered at the end of the list. */
  newRoute: "חדש — ייווצר בשמירה",
} as const;

/** A route number in the "מספר מסלול" list and value: "מסלול {r}". */
export function routeNumberText(routeNumber: number): string {
  return "מסלול " + routeNumber;
}

/** A package type's subtitle in the "סוג מארז" list: how many routes it has. */
export function kitRoutesText(n: number): string {
  if (n === 0) return ROUTE_PICK_TEXT.noRoutes;
  return n === 1 ? UNDRAWN_TEXT.routesOne : n + " מסלולים";
}

/** A route number's subtitle: its steps ("4 עמדות"), and whether it is the kit's default. */
export function routeNumberSubText(stations: number, isDefault: boolean): string {
  const count = stations === 0 ? STEPS_PARTS_TEXT.noSteps : stations === 1 ? UNDRAWN_TEXT.stationsOne : stations + " עמדות";
  return isDefault ? count + " · " + ROUTE_PICK_TEXT.defaultRoute : count;
}

/** "שלבי המסלול": the parts of the kit (the box and its template lines) beside the steps editor. */
export const STEPS_PARTS_TEXT = {
  navLabel: "חלקי המארז",
  box: "המארז עצמו",
  items: "פריטים במארז",
  noLines: "לסוג המארז אין תכולה עדיין.",
  editContents: "עריכת התכולה",
  noSteps: "ללא עמדות",
  /** A part's sub-line while its route does not exist: "מסלול {r} · טרם נוצר". */
  notCreated: "טרם נוצר",
  newRoute: "מסלול חדש — ייווצר בשמירה",
  dirty: "לא נשמר",
  /** The editor's note under an item's title: where its route number comes from. */
  itemRouteFrom: "מספר המסלול של הפריט נקבע בתכולת המארז.",
  /** Under the rule a step list breaks (route-rules.ts' reason before it). */
  ruleTail: "אפשר לשמור, אבל קליטת מארז מהסוג הזה תיחסם עד שהמסלול יתוקן.",
  loadFailed: "טעינת תכולת המארז נכשלה. בדוק את החיבור לשרת ונסה שוב.",
  /** A package-level step whose station type has a package template (popup-templates PLAN.md §5,
   *  step 2.6): the role it plays, and when its place calls for the other one. Not approved yet. */
  templateRole: (role: "opening" | "closing") => (role === "opening" ? "תבנית פתיחה" : "תבנית סגירה"),
  templateRoleMismatch: (role: "opening" | "closing") => (role === "opening"
    ? "לעמדה יש תבנית פתיחה, אבל כאן היא סוגרת את המארז. כאן ייפתח אשף הסגירה של היום."
    : "לעמדה יש תבנית סגירה, אבל כאן היא פותחת את המארז. כאן ייפתח אשף הפתיחה של היום."),
  templateLink: "פתח את תבנית החלון",
} as const;

/** The steps editor's title: "שלבי המארז" / "שלבי {item}". */
export function stepsTitleText(item: string | null): string {
  return item == null ? "שלבי המארז" : "שלבי " + item;
}

/** A shared item route in the steps editor (the map's "משותף" notice, about steps): "מסלול {r} של
 *  {item} משמש גם ב: {kits}. שינוי בשלבים יחול גם שם." */
export function sharedStepsNoticeText(routeNumber: number, item: string, kits: readonly string[]): string {
  return "מסלול " + routeNumber + " של " + item + " משמש גם ב: " + kits.join(", ") + ". שינוי בשלבים יחול גם שם.";
}

/** The route combobox value, artboards 1, 11: "{type} · מסלול {r}" ("מארז עמדת עבודה · מסלול 1"). */
export function routeOptionText(typeDesc: string, routeNumber: number): string {
  return typeDesc + " · מסלול " + routeNumber;
}

/** No route chosen and none remembered (spec §5.2). */
export const NO_ROUTE_TEXT = "בחר סוג מארז ומספר מסלול";

// ---- the map: rows, columns, cells (artboards 1, 11) ---------------------------------------------
/** The two fixed rows of a kit's map (spec §5.4.1). */
export const BOX_ROW_TEXT = { title: "הקופסה", sub: "שדות על המארז עצמו" } as const;
export const EACH_ITEM_ROW_TEXT = { title: "כל פריט במארז", sub: "שדות משותפים לכל הפריטים" } as const;

/** A line's seq badge: "01", or the range of a line with several units "02–03" (en dash). */
export function seqText(from: number, to: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return to > from ? pad(from) + "–" + pad(to) : pad(from);
}

/** A line's quantity beside its name: "×2". */
export function qtyText(quantity: number): string {
  return "×" + quantity;
}

/** A line's sub-line, artboards 1, 11: "מסלול {r} · {n} עמדות" — n counts every step of the route. */
export function lineSubText(routeNumber: number, stations: number): string {
  return "מסלול " + routeNumber + " · " + (stations === 1 ? UNDRAWN_TEXT.stationsOne : stations + " עמדות");
}

/** A line without its item route: the existing reason text of the package route rules
 *  (src/app/lib/packages/route-rules.ts, checkItemRouteAgainstPackage). */
export function lineRouteMissingText(routeNumber: number): string {
  return "לסוג הפריט אין מסלול מספר " + routeNumber;
}

/** A kit without its own route: the existing reason text of checkPackageRoute (route-rules.ts). */
export function kitRouteMissingText(routeNumber: number): string {
  return "לסוג המארז אין מסלול מספר " + routeNumber;
}

/** Map header row and column headers (spec §5.4.2; artboard 1). */
export const MAP_TEXT = {
  sectionLabel: "מפת שדות",
  corner: "פריט / עמדה",
  /** Package-level column: the Tag, and the caption on top of the one-card frame. */
  kitCard: "כרטיס מארז",
  oneCardForKit: "כרטיס אחד לכל המארז",
  /** Item column. */
  perItem: "לכל פריט בנפרד",
  /** Cells. */
  empty: "ללא שדות",
  defineFields: "הגדר שדות",
  na: "—",
  naLabel: "לא במסלול",
  unpublished: "שינוי שלא פורסם",
  setUpdated: "הערכה עודכנה",
  oneError: "שגיאה אחת",
  /** The Link2 icon of a shared row (its role="img" aria-label). */
  sharedIconLabel: "משותף עם מארז אחר",
  /** Toolbar. */
  filterGroupLabel: "סינון תאים",
  filterAll: "הכל",
  filterEmpty: "ללא שדות",
  filterErrors: "שגיאות",
  filterUnpublished: "לא פורסמו",
  previewAsWorker: "תצוגה מקדימה כעובד",
  copyFromRoute: "העתק ממסלול אחר…",
  /** The error bar's action. */
  goToField: "עבור לשדה",
} as const;

/** The column header's accessible name (artboard 1): "בחירת כל התאים בעמדה {name}". */
export function columnPickLabel(station: string): string {
  return "בחירת כל התאים בעמדה " + station;
}

/** The column header's last line (artboards 1, 11): "מוגדרים {defined}/{relevant}". */
export function columnCoverageText(defined: number, relevant: number): string {
  return "מוגדרים " + defined + "/" + relevant;
}

/** A filter chip (artboard 1): "הכל · 20", "ללא שדות · 5", "שגיאות · 1", "לא פורסמו · 1". */
export function filterChipText(label: string, n: number): string {
  return label + " · " + n;
}

/** A cell's accessible name (artboard 1 `aria`): "{station} · {row}". */
export function cellLabel(station: string, row: string): string {
  return station + " · " + row;
}

/** Artboard 11 (`aria`): a shared cell "{station} · {row} · {n} שדות משותפים", an empty one
 *  "{station} · {row} · ללא שדות". */
export function sharedCellLabel(station: string, row: string, fields: number): string {
  return cellLabel(station, row) + " · " + fields + " שדות משותפים";
}
export function emptyCellLabel(station: string, row: string): string {
  return cellLabel(station, row) + " · " + MAP_TEXT.empty;
}

/** A cell's error line (artboard 1): "שגיאה אחת"; more than one is undrawn. */
export function cellErrorsText(n: number): string {
  return n === 1 ? MAP_TEXT.oneError : n + UNDRAWN_TEXT.errorsSuffix;
}

/** A cell linked to a field set (artboard 1 `setTag`): "ערכה: {name}" — the full name, ellipsed by
 *  CSS (spec §10.3). */
export function setTagText(setName: string): string {
  return "ערכה: " + setName;
}

/** The "—" cell of an item that does not pass the station: "עמדת {station} לא נמצאת במסלול {r} של
 *  {item}". Artboard 1's `tip` reads "{item} לא עוברת בעמדת {station} במסלול {r}", whose feminine verb
 *  is wrong for most item names (spec §10.4); the station leads instead, so the verb always agrees
 *  (approved on 2026-10-14). */
export function notOnRouteTooltip(item: string, station: string, routeNumber: number): string {
  return "עמדת " + station + " לא נמצאת במסלול " + routeNumber + " של " + item;
}

/** A shared row's Link2 title (artboards 1, 11): "משותף ל: {kits}". Several kits are joined with
 *  ", " — the artboards draw one. */
export function sharedRowTitle(kits: readonly string[]): string {
  return "משותף ל: " + kits.join(", ");
}

/** A shared cell's tooltip (artboard 11): "הוגדר במסלול {r} של {item} · משותף עם {kits}". */
export function sharedCellTooltip(routeNumber: number, item: string, kits: readonly string[]): string {
  return "הוגדר במסלול " + routeNumber + " של " + item + " · משותף עם " + kits.join(", ");
}

/** Artboard 11's info bar: "{n} תאים כבר מלאים: {item} משתמש במסלול {r} שלו, שמוגדר גם ב{kit}." and
 *  its link "פתח את {kit}". The artboard draws n = 3; a single cell is undrawn. */
export function sharedFilledText(cells: number, item: string, routeNumber: number, kits: readonly string[]): string {
  const head = cells === 1 ? UNDRAWN_TEXT.sharedFilledOne : cells + " תאים כבר מלאים";
  return head + ": " + item + " משתמש במסלול " + routeNumber + " שלו, שמוגדר גם ב" + kits.join(", ") + ".";
}
export function openKitText(kit: string): string {
  return "פתח את " + kit;
}

/** The map footer's summary, artboard 1: "37 שדות · 5 תאים ללא שדות · שגיאה אחת"; artboard 11
 *  (every defined cell shared): "8 שדות משותפים · 13 תאים ללא שדות". Zero parts are left out — the
 *  artboards never draw "0 …" (an assumption: no footer without errors is drawn either). */
export function mapFooterText(t: { fields: number; emptyCells: number; errors: number; sharedOnly: boolean }): string {
  const parts: string[] = [];
  if (t.fields > 0) {
    if (t.sharedOnly) parts.push(t.fields === 1 ? UNDRAWN_TEXT.sharedFieldsOne : t.fields + " שדות משותפים");
    else parts.push(fieldsText(t.fields));
  }
  if (t.emptyCells > 0) parts.push(t.emptyCells === 1 ? UNDRAWN_TEXT.emptyCellsOne : t.emptyCells + " תאים ללא שדות");
  if (t.errors > 0) parts.push(cellErrorsText(t.errors));
  return parts.join(" · ");
}

/** The map footer's legend (artboards 1, 11). */
export const LEGEND_TEXT = {
  defined: "מוגדר",
  empty: "ללא שדות — העובד יראה את החלון הקבוע",
  na: "לא במסלול",
  error: "שגיאה",
  unpublished: "שינוי שלא פורסם",
  shared: "משותף עם מארז אחר",
  kitLevel: "עמדה ברמת מארז · כרטיס אחד",
} as const;

/** The map footer's keyboard hint (artboard 1), and artboard 11's (the onboarding map). */
export const MAP_HINT_TEXT = {
  keys: "חיצים לניווט · Shift לבחירת טווח · Enter לעריכה · Ctrl C / Ctrl V",
  clickOpens: "לחיצה על תא פותחת את עורך השדות",
} as const;

/** The map's error bar (artboard 1): "{station} · {item}: {message}". An empty option takes the
 *  artboard's own wording ("אפשרות ריקה בשדה '{field}'", optionEmptyMapText); every other issue
 *  its lint message. */
export function mapErrorBarText(station: string, item: string, issue: Pick<Issue, "code" | "message">, fieldLabel: string | null): string {
  if (issue.code === "OPTION_LABEL_EMPTY" && fieldLabel != null) return optionEmptyMapText(station, item, fieldLabel);
  return station + " · " + item + ": " + issue.message;
}

/** The selection bar (artboard 1). */
export const BULK_TEXT = {
  toolbarLabel: "פעולות על התאים שנבחרו",
  sharedEdit: "עריכה משותפת",
  applySet: "החל ערכת שדות…",
  paste: "הדבק",
  copy: "העתק",
  clear: "נקה",
  deselect: "בטל בחירה",
} as const;

// ---- the map's other states (artboard 11) -------------------------------------------------------
export const MAP_STATE_TEXT = {
  noStepsTitle: "למסלול אין שלבים",
  noStepsBody: "הוסיפו עמדות כדי להגדיר להן שדות.",
  noStepsAction: "עבור לשלבי המסלול",
  noContentsTitle: "לסוג המארז אין תכולה",
  noContentsBody: "הגדירו פריטים במארז כדי לראות אותם במפה.",
  noContentsAction: "פתח את הגדרות המארזים",
  loadFailedTitle: "טעינת הגדרות השדות נכשלה",
  loadFailedBody: "המסלול לא מוצג כריק כדי לא לאבד נתונים.",
  retry: "נסה שוב",
  retrying: "טוען…",
} as const;

// ---- the editor card's footer (artboard 2) --------------------------------------------------------
/** Artboard 2 (`footLabel`): "{N} שדות · {M} חובה[ · {K} שורות ללא שם] · גרירה או Alt+חיצים לשינוי
 *  סדר", with "שדה אחד", "חובה אחד", "שורה אחת ללא שם". N counts named fields only. */
export function editorFooterText(named: number, required: number, unnamed: number): string {
  const foot = [fieldsText(named), required === 1 ? "חובה אחד" : required + " חובה"];
  if (unnamed > 0) foot.push(unnamed === 1 ? "שורה אחת ללא שם" : unnamed + " שורות ללא שם");
  foot.push("גרירה או Alt+חיצים לשינוי סדר");
  return foot.join(" · ");
}

// ---- "סוג שדה אחר" — the field type picker (artboard 3, spec §5.6) ---------------------------------
/** Each type's name and description in the picker (artboard 3 `types`, spec §5.6 table). */
export const FIELD_TYPE_TEXT: Record<FieldType, { name: string; desc: string }> = {
  choice_row: { name: "שורת בדיקה", desc: "שם · בחירה מ-4 אפשרויות · הערות" },
  pass_fail: { name: "תקין / לא תקין", desc: "שני כפתורים גדולים" },
  number: { name: "מספר", desc: "ערך עם יחידה, טווח או ערך ייחוס ±%" },
  text: { name: "טקסט קצר", desc: "שורה אחת חופשית" },
  textarea: { name: "טקסט ארוך", desc: "פסקה, עד 3 שורות" },
  checklist: { name: "רשימת סימון", desc: "כמה תיבות סימון, כמו בבדיקת הסגירה" },
  multi_choice: { name: "בחירה מרובה", desc: "אפשר לבחור יותר מאפשרות אחת" },
  // Artboard 3 says "סוג צילום ומינימום תמונות"; the field owns its photo group, so only the minimum is left (not approved).
  photo: { name: "צילום", desc: "מינימום תמונות" },
  scan: { name: "סריקה", desc: "שדה לקורא ברקוד" },
  section: { name: "כותרת מקטע", desc: "מחלקת את השדות לקבוצות בחלון" },
};

/** The picker's group headers (artboard 3 `types[].g`). */
export const FIELD_TYPE_GROUP_TEXT = {
  common: "נפוץ",
  measure: "מדידה וטקסט",
  choice: "בחירה",
  record: "תיעוד",
  structure: "מבנה",
} as const;

/** The picker's fixed text (artboard 3). */
export const TYPE_PICKER_TEXT = {
  dialogLabel: "הוספת שדה מסוג אחר",
  searchLabel: "חיפוש סוג שדה",
  searchPlaceholder: "חיפוש סוג שדה…",
  defaultTag: "ברירת מחדל",
  /** The key hint on the active row (set left to right). */
  enterKey: "Enter",
  noResultsTitle: "אין סוג שדה מתאים",
  noResultsText: "נסו מילה אחרת, למשל \"מספר\" או \"צילום\"",
  /** The pearl footer: "טיפ: Enter בשם השדה האחרון מוסיף שורת בדיקה חדשה" — the key set apart so it
   *  is isolated left to right. */
  tipLead: "טיפ: ",
  tipKey: "Enter",
  tipTail: " בשם השדה האחרון מוסיף שורת בדיקה חדשה",
} as const;

// ---- the expanded number row (artboard 3, spec §5.6) -------------------------------------------------
/** The settings grid of a number field (artboard 3, `gnd-settings`). */
export const NUMBER_SETTINGS_TEXT = {
  unit: "יחידה",
  min: "מינימום",
  max: "מקסימום",
  /** Placeholder of מינימום / מקסימום (and of the unit select while the field has no unit). */
  emptyValue: "—",
  ref: "ערך ייחוס",
  refPlaceholder: "לא בשימוש",
  tol: "סטייה מותרת ±%",
  tolPlaceholder: "5",
  tolHelpOff: "זמין לאחר הזנת ערך ייחוס",
  tolHelpOn: "סטייה מותרת מערך הייחוס, באחוזים",
  outOfRangeFail: "ערך מחוץ לטווח נחשב \"לא תקין\"",
  help: "טקסט עזרה לעובד",
  helpPlaceholder: "למשל: היכן ואיך למדוד",
  helpNote: "מוצג מתחת לשם השדה בחלון העובד",
  close: "סגור הגדרות",
} as const;

/** The "יחידה" select: artboard 3 draws one unit, "Ω אוהם" — the list itself is not verified (spec
 *  §5.6 "לא אומת"). A field's own unit outside this list stays selectable as itself. */
export const NUMBER_UNITS: readonly { value: string; name: string }[] = [{ value: "Ω", name: "אוהם" }];

/** The summary button of a number row (artboard 3 `rangeShort` and the button's text). */
export const NUMBER_SUMMARY_TEXT = {
  unitLead: "יחידה ",
  noRange: "ללא טווח",
  maxShort: "מקס׳ ",
  minShort: "מינ׳ ",
} as const;

/** The live preview's line under a number field (artboard 3 `rangeMsg`, spec §5.6 last bullet). */
export const NUMBER_PREVIEW_TEXT = {
  inRange: "בטווח",
  outOfRange: "מחוץ לטווח",
  markedFail: "יסומן לא תקין",
  noRange: "ללא טווח מוגדר",
} as const;

// ---- options of a choice field (artboard 4, spec §5.7) -------------------------------------------------
/** The popover's fixed text (artboard 4). */
export const OPTION_LIST_TEXT = {
  sourceGroup: "מקור האפשרויות",
  shared: "רשימה משותפת",
  local: "רק לשדה הזה",
  close: "סגירה",
  /** role="list" aria-label. */
  list: "אפשרויות",
  /** "מקשים 1–4 לבחירה מהירה בעמדה", the key range set apart so it is isolated left to right. */
  keysLead: "מקשים ",
  keysRange: "1–4",
  keysTail: " לבחירה מהירה בעמדה",
  /** The key box from the fifth option on (U+2013), with its title. */
  noKey: "–",
  noKeyTitle: "אין מקש קיצור לאפשרות זו",
  toneTitle: "לחיצה מחליפה: תקין ← אזהרה ← כשל ← ניטרלי",
  addLabel: "אפשרות חדשה",
  addPlaceholder: "הוסף אפשרות (Enter)",
  add: "הוסף",
  cancel: "ביטול",
  apply: "החל על השדה",
} as const;

/** The head (artboard 4): "אפשרויות · {field}". */
export function optionListTitle(field: string): string {
  return field.trim() ? "אפשרויות · " + field.trim() : OPTION_LIST_TEXT.list;
}

/** Local mode's box title (artboard 4): "אפשרויות מקומיות · {station} · {item}". */
export function localOptionsTitle(station: string, item: string): string {
  return "אפשרויות מקומיות · " + station + " · " + item;
}

/** Local mode's note (artboard 4 `localNote`): 'הועתקו מהרשימה "{list}". שינוי כאן חל רק על {field} ולא
 *  ישפיע על שדות אחרים.' Without the list's name, the first sentence is undrawn. */
export function localOptionsNote(field: string, listName: string | null): string {
  const copied = listName != null ? "הועתקו מהרשימה \"" + listName + "\"." : UNDRAWN_TEXT.optionsCopiedFromSharedList;
  return copied + " שינוי כאן חל רק על " + field + " ולא ישפיע על שדות אחרים.";
}

/** The options' header (artboard 4 `optsTitle`): "אפשרויות לשדה הזה · {n}" (local) /
 *  "אפשרויות · {n}" (shared). */
export function optionsCountText(n: number, local: boolean): string {
  return (local ? "אפשרויות לשדה הזה" : "אפשרויות") + " · " + n;
}

/** An option row's accessible name (artboard 4 `aria`): "אפשרות {n}: {label} · {tone word}", an
 *  empty label read as "ריקה". `index` is 0-based. */
export function optionRowLabel(index: number, label: string, tone: Tone): string {
  return "אפשרות " + (index + 1) + ": " + (label || "ריקה") + " · " + TONE_WORD[tone];
}

/** The key box's title (artboard 4 `keyTitle`): "מקש {n} לבחירה מהירה", from the fifth option on
 *  OPTION_LIST_TEXT.noKeyTitle. `index` is 0-based. */
export function optionKeyTitle(index: number): string {
  return index < 4 ? "מקש " + (index + 1) + " לבחירה מהירה" : OPTION_LIST_TEXT.noKeyTitle;
}

/** The label input's name (artboard 4): "שם האפשרות {n}". `index` is 0-based. */
export function optionNameLabel(index: number): string {
  return "שם האפשרות " + (index + 1);
}

/** The tone button's name (artboard 4 `toneAria`): "סוג האפשרות: {w}. לחיצה מחליפה ל{next}". */
export function toneButtonLabel(tone: Tone, next: Tone): string {
  return "סוג האפשרות: " + TONE_WORD[tone] + ". לחיצה מחליפה ל" + TONE_WORD[next];
}

/** The drag handle's name (artboard 4): "גרירה לשינוי סדר: {label}". */
export function optionDragLabel(label: string): string {
  return "גרירה לשינוי סדר: " + label;
}

/** The × button's name (artboards 2, 4): "הסרת האפשרות {label}". */
export function optionRemoveLabel(label: string): string {
  return "הסרת האפשרות " + label;
}

// ---- the station field editor (artboard 2, spec §5.5) -----------------------------------------------
/** Text of the editor no artboard draws (spec §5.5, §10.3, §10.4), approved on 2026-10-14. */
export const EDITOR_UNDRAWN_TEXT = {
  // the row ⋯ menu (spec §5.5.2: "התפריט לא מצויר"; the proposal is two words artboard 8
  // already has).
  rowDuplicate: "שכפל",
  rowDelete: "מחק",
  // the confirm of the card's ⋯ "נקה את התא" (spec §10.4 "אישורים: … 'נקה'"). The cancel
  // button reuses the discard confirm's "המשך לערוך".
  clearTitle: "לנקות את התא?",
  clearMessage: "כל השדות של התא יוסרו מהטיוטה. ביטול הטיוטה מחזיר אותם.",
  clearCancel: UNDRAWN_TEXT.discardCancel,
  // the shared notice when the route runs in more than one other kit — artboard 2's
  // "בשניהם" is right for two kits only (spec §5.5.2 ⚠, §10.4).
  sharedAll: "שינוי כאן יחול בכולם.",
  // a field linked to a shared option list whose name this screen does not hold yet
  // (the option-lists API arrives in session 2d): "רשימה: רשימה משותפת" — artboard 4's own word for a
  // shared list.
  listUnnamed: "רשימה משותפת",
  // the locked rows of a station that opens PopUpTestDialog (spec §10.3: artboard 2 draws
  // the VerdictStation / PhotoStation wording; the dialog has no "בדיקה תקינה?"). The words are the
  // dialog's own labels ("תוצאת בדיקה", "עובד מבצע", "הערות נוספות", "שמור וסיים").
  lockedTopDialog: "תוצאת בדיקה · עובד מבצע",
  // the locked rows of a station whose popup is built from its station type's template
  // (docs/popup-templates/PLAN.md §1.8): the template places the fields, so the rows name it, not
  // a fixed wizard. Not approved yet.
  lockedTopTemplate: "רכיבי תבנית החלון שלפני השדות · נקבעים בתבניות חלון",
  lockedBottomTemplate: "פסק דין · תמיד אחרון",
  templateNote: "החלון בעמדה הזו נבנה מתבנית החלון של סוג העמדה. השדות מופיעים במקום שהתבנית קובעת.",
  // a package-level step whose station type has a package template (PLAN.md §5, step 2.6).
  packageTemplateNote: "החלון בעמדה הזו נבנה מתבנית החלון של סוג העמדה, על בסיס האשף של המארז.",
  packageTemplateMismatch: "לעמדה יש תבנית בתפקיד אחר מזה של הצעד הזה במסלול, ולכן כאן ייפתח האשף של היום.",
  templateLink: "פתח את תבנית החלון",
  lockedBottomDialog: "הערות נוספות · 'שמור וסיים' · תמיד אחרון",
  // the locked rows of a package-level step (spec §5.5.2 ב/ה "לא אומת לעורך"), in the
  // package wizards' own step names and questions. Opening wizard: the box fields sit in "צילום הקופסה"
  // before "האריזה תקינה?"; an item's in its photo phase before "הפריט תקין?".
  lockedTopOpenBox: "סריקת מק״ט המארז · צילום הקופסה · חלק קבוע",
  lockedBottomOpenBox: "פסק דין · 'האריזה תקינה?' · תמיד אחרון",
  lockedTopOpenItem: "סריקה · צילום · חלק קבוע",
  lockedBottomOpenItem: "פסק דין · 'הפריט תקין?' · תמיד אחרון",
  // Closing wizard: the box fields open "תקינות האריזה"; an item's sit under its row in "פריטים ואריזה".
  lockedTopCloseBox: "סריקת מק״ט המארז · פריטים ואריזה · חלק קבוע",
  lockedTopCloseItem: "סריקת מק״ט המארז · חלק קבוע",
  lockedBottomClose: "תקינות האריזה · 'סגור מארז' · תמיד אחרון",
} as const;

/** Fixed text of the editor (artboard 2 DOM and script, spec §5.5). */
export const EDITOR_TEXT = {
  /** The breadcrumb <nav aria-label="מיקום">: "חזרה למפה", "מפת שדות › {station} › {item}". */
  breadcrumbLabel: "מיקום",
  backToMap: "חזרה למפה",
  mapCrumb: VIEW_TAB_TEXT.map,
  /** The station bar <section aria-label="עמדות המסלול">. */
  timelineLabel: "עמדות המסלול",
  prevStation: "העמדה הקודמת",
  /** A stop's line when its column has an error (red / 600). */
  stopError: "שגיאה",
  /** The card header's Tag: an item column (artboard 2) / a package-level column (spec §5.5.1 — the
   *  station types screen's Tag). */
  perItem: MAP_TEXT.perItem,
  packageLevel: "עמדה ברמת מארז",
  /** The card's ⋯ (artboard 2 aria-label, every item there) — cellMenuText names the items a menu
   *  really has. Its items: "שמור כערכה…", "החל ערכה…" (spec §5.5.1), "נקה את התא". */
  cellMenuLabel: "פעולות נוספות לתא: שמור כערכה, החל ערכה, נקה את התא",
  saveAsSet: "שמור כערכה…",
  applySet: "החל ערכה…",
  clearCell: "נקה את התא",
  /** The target chips (artboard 2; a package-level column's from artboard 7). */
  targetsLabel: "הפריט שעבורו מגדירים שדות",
  targetsLead: "פריט:",
  boxChip: BOX_ROW_TEXT.title,
  eachItemChip: "כל פריט",
  /** The locked rows of VerdictStation / PhotoStation (artboard 2). */
  lockedTopStation: "סריקת מק״ט יצרן · חלק קבוע · שלב 1 בחלון",
  lockedBottomStation: "פסק דין · 'בדיקה תקינה?' · תמיד אחרון",
  /** The rows table's column header (aria-hidden). */
  colName: "שם השדה",
  colOptions: "אפשרויות · בחירה מהירה",
  colNotes: "הערות",
  colRequired: "חובה",
  /** A row. */
  unnamedRow: "שורה ללא שם",
  nameLabel: "שם השדה",
  namePlaceholder: "שם השדה",
  newNamePlaceholder: "לדוגמה: מאוורר מעבד",
  numberTile: "שדה מספר",
  passFailTile: "שדה תקין / לא תקין",
  /** A section row. */
  sectionLabel: "כותרת מקטע",
  sectionCaption: "כותרת מקטע · מקבצת את השורות שמתחתיה",
  newSection: "מקטע חדש",
  /** Options of a choice row. */
  optionNameLabel: "שם האפשרות",
  newOption: "אפשרות חדשה",
  addOption: "אפשרות",
  listCustom: "רשימה: מותאמת לשדה",
  /** ToneMenu. */
  toneMenuLabel: "עריכת אפשרות",
  toneMenuTitle: "סוג האפשרות",
  close: "סגירה",
  deleteOption: "מחק אפשרות",
  /** A number row (artboard 2). */
  unit: "יחידה",
  max: "מקס׳",
  numberCaption: "מספר · מחוץ לטווח = כשל",
  /** A pass / fail row. */
  passFailCaption: "תקין / לא תקין",
  draftNew: "חדש בטיוטה",
  /** NotesModeSelect. */
  notesListLabel: "מצב הערות",
  notesFootnote: "חובה בכשל: העובד חייב לפרט כשנבחרה אפשרות מסוג כשל.",
  /** NoteMaxSelect. */
  noteMaxTitle: "אורך מרבי להערה",
  noteMaxHeader: "אורך מרבי",
  noteMaxFootnote: "העובד רואה מונה תווים מ-80% מהאורך.",
  /** The "חובה" chip. */
  required: "חובה",
  /** AddFieldBar. */
  addRow: "הוסף שורת בדיקה",
  addRowCaption: "שם · בחירה מתוך 4 אפשרויות · הערות",
  otherType: "סוג שדה אחר",
  addSection: "כותרת מקטע",
} as const;

/** A new "שורת בדיקה"'s options (artboard 2 script `lists.L1`, the list "תקינות כללית"). */
export const DEFAULT_CHOICE_OPTIONS: readonly { label: string; tone: Tone }[] = [
  { label: "תקין", tone: "pass" },
  { label: "תקין עם הערה", tone: "warn" },
  { label: "לא תקין", tone: "fail" },
  { label: "לא נבדק", tone: "neutral" },
];

/** A row's name in the accessible names below — its label, or "שורה ללא שם" (artboard 2 `label`). */
export function rowNameText(label: string): string {
  return label.trim() || EDITOR_TEXT.unnamedRow;
}

/** The words of artboard 2's ⋯ aria-label, one per menu item, in the menu's order. */
export const CELL_MENU_WORDS = { saveAsSet: "שמור כערכה", applySet: "החל ערכה", clear: "נקה את התא" } as const;
export type CellMenuItem = keyof typeof CELL_MENU_WORDS;

/** The ⋯'s aria-label (artboard 2): "פעולות נוספות לתא: {items}" — only the items the menu has, in
 *  its order ("פעולות נוספות לתא: שמור כערכה, החל ערכה, נקה את התא" with all three). */
export function cellMenuText(items: readonly CellMenuItem[]): string {
  const order: CellMenuItem[] = ["saveAsSet", "applySet", "clear"];
  return "פעולות נוספות לתא: " + order.filter((i) => items.includes(i)).map((i) => CELL_MENU_WORDS[i]).join(", ");
}

/** The card's h2 (artboard 2): "שלב {n} מתוך {total} · {station}". */
export function editorTitleText(n: number, total: number, station: string): string {
  return "שלב " + n + " מתוך " + total + " · " + station;
}

/** The card's sub-line (artboard 2): "מה העובד ממלא בעמדה הזו עבור: {item}". */
export function editorSubText(item: string): string {
  return "מה העובד ממלא בעמדה הזו עבור: " + item;
}

/** The fields sub-tab (artboard 2 `fieldCount`, named fields only): "שדות · {n}". */
export function fieldsTabText(named: number): string {
  return "שדות · " + named;
}

/** The station bar's end button (artboard 2): "העמדה הבאה: {name}". */
export function nextStationText(name: string): string {
  return "העמדה הבאה: " + name;
}

/** A stop's line (artboard 2 `stopsRaw`): "{N} שדות" / "שדה אחד", or "שגיאה". */
export function stopSubText(fields: number, errors: number): string {
  return errors > 0 ? EDITOR_TEXT.stopError : fieldsText(fields);
}

/** A target chip (artboard 2 `targets`, artboard 7): "{lead} · {named}" — "מחשב · 5", "מסך ×2 · 3",
 *  "הקופסה · 3", "01 מחשב · 2". */
export function targetChipText(lead: string, named: number): string {
  return lead + " · " + named;
}

/** The shared notice (artboard 2): "השדות נשמרים במסלול {r} של {item} ומשמשים גם ב: {kits}. שינוי כאן
 *  יחול בשניהם." — more than one other kit ends undrawn. */
export function sharedNoticeText(routeNumber: number, item: string, kits: readonly string[]): string {
  const tail = kits.length > 1 ? EDITOR_UNDRAWN_TEXT.sharedAll : "שינוי כאן יחול בשניהם.";
  return "השדות נשמרים במסלול " + routeNumber + " של " + item + " ומשמשים גם ב: " + kits.join(", ") + ". " + tail;
}

/** The settings of a checklist row and of a photo row. No artboard draws them (spec §5.5.2: "photo:
 *  photo_type … ו-min. checklist: items[]" — "לא אומת"), so every word here is our own (approved on
 *  2026-10-14). Each is patterned on the drawn wording of the option chips (artboard 2), the option list's add input
 *  (artboard 4) and the type picker's descriptions (artboard 3). */
export const FIELD_SETTINGS_UNDRAWN_TEXT = {
  // the checklist row's add input — artboard 4's "הוסף אפשרות (Enter)" / "אפשרות חדשה"
  // with the checklist's own word ("תיבת סימון", the lint messages').
  checklistAddPlaceholder: "הוסף תיבת סימון (Enter)",
  checklistAddLabel: "תיבת סימון חדשה",
  // a checklist box's rename input — artboard 2's "שם האפשרות".
  checklistItemName: "שם תיבת הסימון",
  // the accessible names of the boxes' group, a box chip and its × — artboard 2's
  // "אפשרויות לשדה {name}", "עריכת האפשרות {label}", "הסרת האפשרות {label}".
  checklistGroupPrefix: "תיבות סימון לשדה ",
  checklistItemEditPrefix: "עריכת תיבת הסימון ",
  checklistItemRemovePrefix: "הסרת תיבת הסימון ",
  // the photo row — the minimum ("מינ׳", the short form artboard 3 uses for a minimum; the input's
  // title spells it out). There is no photo type to pick: the field owns its photo group.
  photoMinLabel: "מינ׳",
  photoMinTitle: "מינימום תמונות",
} as const;

/** The checklist row's boxes (undrawn): "תיבות סימון לשדה {name}". */
export function checklistGroupLabel(fieldLabel: string): string {
  return FIELD_SETTINGS_UNDRAWN_TEXT.checklistGroupPrefix + rowNameText(fieldLabel);
}

/** A checklist box chip (undrawn): "עריכת תיבת הסימון {label}". */
export function checklistItemEditLabel(label: string): string {
  return FIELD_SETTINGS_UNDRAWN_TEXT.checklistItemEditPrefix + label;
}

/** A checklist box's × (undrawn): "הסרת תיבת הסימון {label}". */
export function checklistItemRemoveLabel(label: string): string {
  return FIELD_SETTINGS_UNDRAWN_TEXT.checklistItemRemovePrefix + label;
}

/** The drag handle (artboard 2 `gripLabel`): "גרירה לשינוי סדר: {name}". */
export function rowGripLabel(label: string): string {
  return "גרירה לשינוי סדר: " + rowNameText(label);
}

/** The row's ⋯ (artboard 2 `moreLabel`): "פעולות נוספות: {name}". */
export function rowMoreLabel(label: string): string {
  return "פעולות נוספות: " + rowNameText(label);
}

/** The options group (artboard 2 `optsLabel`): "אפשרויות לשדה {name}". */
export function optionsGroupLabel(label: string): string {
  return "אפשרויות לשדה " + rowNameText(label);
}

/** A chip (artboard 2 `aria`): "עריכת האפשרות {label} · {tone word}". */
export function optionEditLabel(label: string, tone: Tone): string {
  return "עריכת האפשרות " + label + " · " + TONE_WORD[tone];
}

/** The list link under the chips (artboard 2 `listText`): "רשימה: {name}" / "רשימה: מותאמת לשדה". A
 *  linked list whose name is unknown is undrawn. */
export function listLinkText(linked: boolean, listName: string | null): string {
  if (!linked) return EDITOR_TEXT.listCustom;
  return "רשימה: " + (listName ?? EDITOR_UNDRAWN_TEXT.listUnnamed);
}

/** NotesModeSelect's button (artboard 2 `notesAria`): "הערות: {mode}". */
export function notesModeAria(modeLabel: string): string {
  return "הערות: " + modeLabel;
}

/** NoteMaxSelect's button (artboard 2 `lenLabel` / `lenAria`). */
export function noteMaxText(n: number): string {
  return "עד " + n + " תווים";
}
export function noteMaxAria(n: number): string {
  return "אורך מרבי להערה: " + n + " תווים";
}

/** A "אורך מרבי" option (artboard 2 `lenOpts`): "{n} תווים", the default "1000 תווים · ברירת מחדל". */
export function noteMaxOptionText(n: number, isDefault: boolean): string {
  return n + " תווים" + (isDefault ? " · ברירת מחדל" : "");
}

/** The "חובה" chip (artboard 2 `reqAria`): "שדה חובה: {name}". */
export function requiredAria(label: string): string {
  return "שדה חובה: " + rowNameText(label);
}

// ---- the live worker preview, "תצוגת העובד · חי" (artboard 2's right column, spec §5.5.3) -----------
/** WorkerPreviewCard's fixed text (artboard 2 DOM and script; "שמור וסיים" is artboard 14's). */
export const PREVIEW_TEXT = {
  title: "תצוגת העובד",
  live: "חי",
  notSaved: "שינוי אפשרות כאן לא נשמר · מתעדכן עם כל עריכה בעורך",
  /** The system note of the VerdictStation / PhotoStation frame; the sample's SKU follows it, left
   *  to right (PREVIEW_SAMPLE.sku). */
  planLead: "נא לבדוק עפ״י תכנית ",
  /** A field without a name, as the preview shows it (artboard 2 `pv`, muted). */
  unnamed: "(ללא שם)",
  /** PopUpTestDialog's finish button (artboard 14). */
  finishDialog: "שמור וסיים",
} as const;

/** Artboard 2's demo item — the sample of its script (`ITEMS`), not a real item: the dummy line
 *  "{item} · {model} · 1005 1509 2600 {suffix}" and the SKU of the system note. */
export const PREVIEW_SAMPLE = {
  model: "Dell OptiPlex 7040",
  idLead: "1005 1509 2600 ",
  idEnd: "01",
  sku: "PC-7040",
} as const;

/** Text of the preview no artboard draws, approved on 2026-10-14. */
export const PREVIEW_UNDRAWN_TEXT = {
  // the mini footer's finish button at a package-level station. Artboard 2 draws the
  // VerdictStation's "סיום בדיקת {station}" only, and the two package wizards end in different
  // buttons; the word is the last step of both wizards' stepper ("סיום").
  finishPackage: "סיום",
} as const;

/** The preview frame's sub-line (artboard 2 `pvSub`): "{station} · {item} · {N} שדות" — N counts
 *  named fields, "שדה אחד" for one. */
export function previewSubText(station: string, item: string, named: number): string {
  return station + " · " + item + " · " + fieldsText(named);
}

/** The preview frame's step (artboard 2): "שלב {n} מתוך {total}". */
export function previewStepText(n: number, total: number): string {
  return "שלב " + n + " מתוך " + total;
}

/** VerdictStation / PhotoStation's finish button (their `finishLabel`): "סיום בדיקת {kind}" from the
 *  station type's name in the DB, "סיום בדיקה" without one. */
export function stationFinishText(stationTypeName: string | null | undefined): string {
  const kind = stationTypeName?.trim();
  return kind ? "סיום בדיקת " + kind : "סיום בדיקה";
}
