import { optionEmptyMapText } from "@/app/lib/station-fields/labels";
import type { Issue } from "@/app/lib/station-fields/validate";

/**
 * Strings of the admin screen "מסלולי בדיקה" (route-fields spec §5). Lint messages, gate texts and
 * everything the worker popups or the API share live in src/app/lib/station-fields/labels.ts:
 * import them from there, never re-type them here.
 *
 * Copied character for character from the artboard scripts and DOM ("·" is U+00B7, "–" is U+2013,
 * "—" is U+2014, "×" is U+00D7). Each count keeps the singular/plural rule of the artboard script
 * that draws it (`n === 1 ? 'שדה אחד' : n + ' שדות'`). A form no artboard draws (a singular, a
 * second error, a save that failed) lives in COPY_PENDING until it is approved (spec "העיצוב סגור"
 * rule 2, §10.4) — listed in the PR under "טקסט לאישור".
 */

// ---- not drawn in any artboard --------------------------------------------------------------
/** Drafts for text the admin artboards never draw. Do not treat as approved copy. */
export const COPY_PENDING = {
  // COPY-PENDING: the header count for a single route — artboards 1–11 draw "14 מסלולים" only.
  routesOne: "מסלול אחד",
  // COPY-PENDING: the context card's kit tag with a single item type / a single unit — artboards 1
  // and 11 draw "{k} סוגי פריטים · {u} יחידות" with k, u ≥ 3.
  kitKindsOne: "סוג פריט אחד",
  kitUnitsOne: "יחידה אחת",
  // COPY-PENDING: a map row whose route has a single station — artboards 1 and 11 draw
  // "מסלול {r} · {n} עמדות" with n ≥ 3.
  stationsOne: "עמדה אחת",
  // COPY-PENDING: the header pill of a published route without a draft (spec §5.2 table, from the
  // old spec — no artboard draws it). Dot --color-status-approved.
  publishedPrefix: "מפורסם · גרסה ",
  // COPY-PENDING: the header while an autosave is in flight and nothing was saved yet (spec §5.2:
  // the artboards draw only "נשמר אוטומטית לפני רגע").
  saving: "שומר…",
  // COPY-PENDING: "נשמר אוטומטית לפני רגע" as a relative time once a minute has passed (spec §5.2
  // "מתעדכן כזמן יחסי"; the artboards draw only "לפני רגע").
  savedAgoPrefix: "נשמר אוטומטית לפני ",
  savedMinuteAgo: "נשמר אוטומטית לפני דקה",
  savedMinutesAgoSuffix: " דקות",
  savedHourAgo: "נשמר אוטומטית לפני שעה",
  savedHoursAgoSuffix: " שעות",
  savedDayAgo: "נשמר אוטומטית לפני יום",
  savedDaysAgoSuffix: " ימים",
  // COPY-PENDING: an autosave (PUT …/fields/draft) or a discard (DELETE) that failed — network or
  // 5xx (spec §3.2 "שמירה נכשלה", §5.2, §10.4). The retry button reuses artboard 11's "נסה שוב".
  saveFailed: "השמירה האוטומטית נכשלה",
  saveRetry: "נסה שוב",
  // COPY-PENDING: 409 DRAFT_CONFLICT — the draft changed since this screen loaded it (another tab
  // or another admin; spec §5.2, §10.4). The action reloads the route from the server.
  conflict: "הטיוטה עודכנה בינתיים במקום אחר — יש לטעון אותה מחדש",
  conflictReload: "טען מחדש",
  // COPY-PENDING: the ConfirmDialog of "ביטול הטיוטה" (spec §5.2: "הטקסט שלו לא מצויר"). The
  // confirm button repeats the header button; ConfirmDialog's default "ביטול" would read as the
  // same action, hence a cancel text of its own.
  discardTitle: "לבטל את הטיוטה?",
  discardMessage: "כל השינויים שלא פורסמו יימחקו, וכל המסלולים במפה יחזרו לגרסה המפורסמת.",
  discardConfirm: "ביטול הטיוטה",
  discardCancel: "המשך לערוך",
  // COPY-PENDING: a cell with more than one error — artboard 1 draws "שגיאה אחת" only (spec §5.4.3,
  // §10.4 "{n} שגיאות בתא"); also the map footer's error count.
  errorsSuffix: " שגיאות",
  // COPY-PENDING: the map footer with a single empty cell / a single shared field — artboards 1 and
  // 11 draw "{n} תאים ללא שדות" and "{n} שדות משותפים" with n ≥ 5.
  emptyCellsOne: "תא אחד ללא שדות",
  sharedFieldsOne: "שדה משותף אחד",
  // COPY-PENDING: artboard 11's info bar with a single filled shared cell (drawn with 3).
  sharedFilledOne: "תא אחד כבר מלא",
  // COPY-PENDING: a single-item route's map (kind "item", spec §5.4.1 "לא אומת"): a package-level
  // step's fields live on the kit's route, so its cell is "—" with this tooltip.
  packageLevelOnItemRoute: "השדות של עמדה ברמת מארז מוגדרים במפת המארז",
  // COPY-PENDING: the group line under each option of the "מסלול" combobox. The spec groups the
  // list "מארזים" / "פריטים" (§5.2, not drawn — the artboards draw the closed field only); a
  // subtitle per option carries it, in the words the app already uses for a kit and an item ("מארז"
  // — the kit Tag of the item-types and packages screens; "פריט").
  routeGroupKit: "מארז",
  routeGroupItem: "פריט",
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
  return n === 1 ? COPY_PENDING.routesOne : n + " מסלולים";
}

/** The context card's count tag, artboards 1, 11: "כיסוי {defined}/{relevant}". */
export function coverageText(defined: number, relevant: number): string {
  return "כיסוי " + defined + "/" + relevant;
}

/** The context card's kit tag, artboards 1, 11: "מארז · {k} סוגי פריטים · {u} יחידות". */
export function kitSummaryText(kinds: number, units: number): string {
  const k = kinds === 1 ? COPY_PENDING.kitKindsOne : kinds + " סוגי פריטים";
  const u = units === 1 ? COPY_PENDING.kitUnitsOne : units + " יחידות";
  return "מארז · " + k + " · " + u;
}

/** The header pill of a published route without a draft — COPY-PENDING (spec §5.2). */
export function publishedPillText(version: number): string {
  return COPY_PENDING.publishedPrefix + version;
}

// ---- header -------------------------------------------------------------------------------------
/** The page header (spec §5.1, §5.2; artboards 1, 11). */
export const HEADER_TEXT = {
  title: "מסלולי בדיקה",
  subtitle: "הגדרת סדר העמדות והשדות שהעובד ממלא בכל עמדה, לפי סוג פריט או מארז.",
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
 *  "נשמר אוטומטית לפני רגע"; later ones are COPY-PENDING. A time in the future (clock skew between
 *  the server's draft_updated_at and this browser) reads as just now. */
export function savedAgoText(savedAtMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - savedAtMs) / 60_000);
  if (minutes < 1) return SAVED_JUST_NOW;
  if (minutes === 1) return COPY_PENDING.savedMinuteAgo;
  if (minutes < 60) return COPY_PENDING.savedAgoPrefix + minutes + COPY_PENDING.savedMinutesAgoSuffix;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return COPY_PENDING.savedHourAgo;
  if (hours < 24) return COPY_PENDING.savedAgoPrefix + hours + COPY_PENDING.savedHoursAgoSuffix;
  const days = Math.floor(hours / 24);
  if (days === 1) return COPY_PENDING.savedDayAgo;
  return COPY_PENDING.savedAgoPrefix + days + COPY_PENDING.savedDaysAgoSuffix;
}

// ---- view tabs and context card -----------------------------------------------------------------
/** Spec §5.2: the `<nav aria-label="תצוגות">` tabs (artboard 1). */
export const VIEW_TAB_TEXT = {
  navLabel: "תצוגות",
  map: "מפת שדות",
  steps: "שלבי המסלול",
  library: "ערכות ורשימות",
} as const;

/** Spec §5.2: the context card (artboards 1, 11). */
export const CONTEXT_CARD_TEXT = {
  sectionLabel: "מסלול נבחר",
  routeLabel: "מסלול",
  openPackages: "פתח במסך המארזים",
  shortcuts: "קיצורי מקלדת",
} as const;

/** The route combobox value, artboards 1, 11: "{type} · מסלול {r}" ("מארז עמדת עבודה · מסלול 1"). */
export function routeOptionText(typeDesc: string, routeNumber: number): string {
  return typeDesc + " · מסלול " + routeNumber;
}

/** No route chosen and none remembered (spec §5.2) — the existing text of page.tsx. */
export const NO_ROUTE_TEXT = "בחר סוג פריט ומספר מסלול";

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
  return "מסלול " + routeNumber + " · " + (stations === 1 ? COPY_PENDING.stationsOne : stations + " עמדות");
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

/** A cell's error line (artboard 1): "שגיאה אחת"; more than one is COPY-PENDING. */
export function cellErrorsText(n: number): string {
  return n === 1 ? MAP_TEXT.oneError : n + COPY_PENDING.errorsSuffix;
}

/** A cell linked to a field set (artboard 1 `setTag`): "ערכה: {name}" — the full name, ellipsed by
 *  CSS (spec §10.3). */
export function setTagText(setName: string): string {
  return "ערכה: " + setName;
}

/** The "—" cell of an item that does not pass the station (artboard 1 `tip`):
 *  "{item} לא עוברת בעמדת {station} במסלול {r}". The artboard's feminine "עוברת" is kept for every
 *  item name (spec §5.4.1, §10.3, §10.4 — the conjugation is pending approval). */
export function notOnRouteTooltip(item: string, station: string, routeNumber: number): string {
  return item + " לא עוברת בעמדת " + station + " במסלול " + routeNumber;
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
 *  its link "פתח את {kit}". The artboard draws n = 3; a single cell is COPY-PENDING. */
export function sharedFilledText(cells: number, item: string, routeNumber: number, kits: readonly string[]): string {
  const head = cells === 1 ? COPY_PENDING.sharedFilledOne : cells + " תאים כבר מלאים";
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
    if (t.sharedOnly) parts.push(t.fields === 1 ? COPY_PENDING.sharedFieldsOne : t.fields + " שדות משותפים");
    else parts.push(fieldsText(t.fields));
  }
  if (t.emptyCells > 0) parts.push(t.emptyCells === 1 ? COPY_PENDING.emptyCellsOne : t.emptyCells + " תאים ללא שדות");
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
