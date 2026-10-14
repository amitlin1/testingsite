import { COPY_PENDING as SCREEN_COPY_PENDING, changesText, routesCountText } from "./labels";

/**
 * Strings of the publish dialog "פרסום גרסה N" (artboard 10, route-fields spec §5.11). Copied
 * character for character from the artboard's DOM and script ("·" is U+00B7); each count keeps the
 * artboard script's singular / plural rule. Shared screen words (the counts the header also uses,
 * the save / conflict notes) are imported from labels.ts, never re-typed.
 *
 * What artboard 10 does not draw — a singular it never shows, a first publish (no version to
 * replace), the dialog's loading and failure states, the Snackbar after a publish — lives in
 * COPY_PENDING until it is approved (spec "העיצוב סגור" rule 2, §10.4), listed in the PR under
 * "טקסט לאישור".
 */

// ---- not drawn in artboard 10 ----------------------------------------------------------------------
/** Drafts for text artboard 10 never draws. Do not treat as approved copy. */
export const PUBLISH_COPY_PENDING = {
  // COPY-PENDING: the Snackbar after a publish (spec §5.11: "Snackbar — הטקסט לא מצויר").
  publishedPrefix: "גרסה ",
  publishedSuffix: " פורסמה",
  // COPY-PENDING: publish-preview failed (network, 5xx, an answer that is not an impact) — the
  // dialog has nothing to show (spec §10.4 "מצבי שגיאה"). The retry reuses artboard 11's "נסה שוב".
  previewFailed: "טעינת פרטי הפרסום נכשלה",
  // COPY-PENDING: publish failed (network, 5xx, a refusal other than 409 / 422).
  publishFailed: "הפרסום נכשל. הטיוטה לא השתנתה.",
  // COPY-PENDING: publish answered 409 DRAFT_CONFLICT — a draft changed since the preview (another
  // tab or admin; spec §3.4.3 step 2). The action reuses the header's "טען מחדש" and loads the
  // preview again.
  publishConflict: "הטיוטה עודכנה בינתיים במקום אחר — יש לטעון את הפרסום מחדש",
  // COPY-PENDING: a first publish — no published version the items on the way follow. Replaces
  // "לפי גרסה {v-1}" in the scope card and the info note ("ימשיכו ללא שדות עד סוף המסלול"),
  // in the words of artboard 1's legend ("ללא שדות — העובד יראה את החלון הקבוע").
  noVersionPhrase: "ללא שדות",
  // COPY-PENDING: the info note with no item on the routes (artboard 10 draws 9).
  noItemsHead: "אין כעת פריטים במסלולים האלה.",
  // COPY-PENDING: the info note with a single item on the routes (artboard 10 draws 9).
  oneItemHead: "פריט אחד נמצא כעת במסלולים האלה.",
  oneItemContinues: "הוא ימשיך",
  // COPY-PENDING: "גם לפריטים שטרם הגיעו…" with a single item to move — the card's tail and the info
  // note's clause (artboard 10 draws 4).
  oneItem: "פריט אחד",
  oneMovedPrefix: "אחד מהם, שטרם הגיע לעמדה ששונתה, יעבור לגרסה ",
  oneMovedSuffix: " בעמדה הבאה שלו",
  // COPY-PENDING: the only item on the routes is the one that moves.
  onlyItemMovesPrefix: "הוא טרם הגיע לעמדה ששונתה, ולכן יעבור לגרסה ",
  // COPY-PENDING: a single item stays on its version (artboard 10 draws "5 האחרים ימשיכו").
  oneOtherContinues: "האחר ימשיך",
  // COPY-PENDING: a removed field filled in a single test (artboard 10 draws "מולא ב-38 בדיקות").
  filledOnce: "מולא בבדיקה אחת, הערכים יישמרו בהיסטוריה",
  // COPY-PENDING: a field set that filled a single cell (artboard 10 draws "4 תאים מולאו").
  setFilledOneCell: "תא אחד מולא",
  // COPY-PENDING: a field set whose name the screen could not read (archived, or the library could
  // not be loaded) — the line without the quoted name.
  setFilledUnnamed: " מערכת שדות",
  // COPY-PENDING: a change artboard 10 has no wording for — rename, tone, notes mode, a removed
  // option, "חובה" turned off, a list link, a section, the note length, a removed step, the layout
  // (spec §5.11 table, last row): the "שונה" / "נמחק" badge and the field's (or station's) name in
  // quotes, until the wording is approved.
  genericQuoteOpen: "'",
  genericQuoteClose: "'",
  // COPY-PENDING: the shared-route note on a single item route's screen — artboard 10's "מחוץ למארז
  // הזה" assumes a kit on screen.
  sharedLeadItemRoute: "השינויים יחולו גם במארזים: ",
  // COPY-PENDING: a route that more than one other kit runs, and more than two such routes —
  // artboard 10 draws one kit per route and two routes ("ב'…', ומסלול … משמש גם ב'…'").
  kitsAnd: " וב",
  kitsComma: ", ב",
  routesComma: ", ",
} as const;

// ---- fixed text (artboard 10 DOM) --------------------------------------------------------------------
export const PUBLISH_TEXT = {
  /** The list's label (its id is the list's aria-labelledby). */
  changesLabel: "מה השתנה",
  /** The ghost toggle beside it (`toggleAllLabel`). */
  collapseAll: "כווץ הכל",
  expandAll: "הרחב הכל",
  /** The Tag of a group whose route other kits run. */
  shared: "משותף",
  /** "הערת גרסה" and its help (the textarea's aria-describedby). */
  noteLabel: "הערת גרסה",
  noteHelp: "תוצג בהיסטוריית הגרסאות",
  /** Footer and header. */
  cancel: "ביטול",
  close: "סגירה",
  /** The first scope card's title. */
  scopeNewTitle: "רק לפריטים חדשים (מומלץ)",
} as const;

/** A change row's round badge: its title and the glyph's aria-label (artboard 10 `KIND`). */
export const CHANGE_BADGE_TEXT = { add: "נוסף", edit: "שונה", del: "נמחק" } as const;

// ---- head ----------------------------------------------------------------------------------------------
/** The title (artboard 10): "פרסום גרסה {v} · {route}" ("פרסום גרסה 5 · מארז עמדת עבודה · מסלול 1"). */
export function publishTitleText(version: number, routeText: string): string {
  return "פרסום גרסה " + version + " · " + routeText;
}

/** The primary button (artboard 10): "פרסם גרסה {v}". */
export function publishButtonText(version: number): string {
  return "פרסם גרסה " + version;
}

/** The count tags (artboard 10): "{n} שינויים" · "{n} עמדות" · "{n} מסלולים". Singulars: the
 *  script's "שינוי אחד", and the screen's (COPY-PENDING) "עמדה אחת" / "מסלול אחד". */
export function countTagsText(totals: { changes: number; stations: number; routes: number }): string[] {
  return [
    changesText(totals.changes),
    totals.stations === 1 ? SCREEN_COPY_PENDING.stationsOne : totals.stations + " עמדות",
    routesCountText(totals.routes),
  ];
}

/** Beside the tags (artboard 10): "מחליפה את גרסה {v-1} המפורסמת"; null on a first publish (no
 *  version to replace — the dialog leaves it out). */
export function replacesVersionText(fromVersion: number): string | null {
  return fromVersion > 0 ? "מחליפה את גרסה " + fromVersion + " המפורסמת" : null;
}

// ---- "מה השתנה" -------------------------------------------------------------------------------------------
/** A group's title (artboard 10): "{station} · {item}" ("חשמל · מחשב"), the station alone on the
 *  kit's own route ("סגירת מארז"). */
export function groupTitleText(station: string, item: string | null): string {
  return item ? station + " · " + item : station;
}

/** The group of a step's layout (artboard 10): "פריסת החלון · {station}". */
export function layoutGroupTitleText(station: string): string {
  return "פריסת החלון · " + station;
}

/** A group's count (artboard 10 `count`): "שינוי אחד" / "{n} שינויים". */
export const groupCountText = changesText;

/** Artboard 10: "נוסף '{label}'". */
export function fieldAddedText(label: string): string {
  return "נוסף '" + label + "'";
}

/** Artboard 10: "'{field}': נוספה אפשרות '{option}'". */
export function optionAddedText(field: string, option: string): string {
  return "'" + field + "': נוספה אפשרות '" + option + "'";
}

/** Artboard 10: "'{field}' סומן כחובה". */
export function requiredOnText(field: string): string {
  return "'" + field + "' סומן כחובה";
}

/** Artboard 10: "נמחק '{label}'". */
export function fieldRemovedText(label: string): string {
  return "נמחק '" + label + "'";
}

/** The warning after a removed field (artboard 10): "מולא ב-{n} בדיקות, הערכים יישמרו בהיסטוריה";
 *  one test is COPY-PENDING; nothing filled, no warning. */
export function filledWarnText(filled: number): string | null {
  if (filled <= 0) return null;
  return filled === 1 ? PUBLISH_COPY_PENDING.filledOnce : "מולא ב-" + filled + " בדיקות, הערכים יישמרו בהיסטוריה";
}

/** Cells a field set filled (artboard 10): "{n} תאים מולאו מהערכה '{set}'". One cell, and a set
 *  whose name is unknown, are COPY-PENDING. */
export function setFilledText(cells: number, setName: string | null): string {
  const head = cells === 1 ? PUBLISH_COPY_PENDING.setFilledOneCell : cells + " תאים מולאו";
  return setName != null ? head + " מהערכה '" + setName + "'" : head + PUBLISH_COPY_PENDING.setFilledUnnamed;
}

/** A change without its own wording (COPY-PENDING, spec §5.11): the name in quotes. */
export function genericChangeText(label: string): string {
  return PUBLISH_COPY_PENDING.genericQuoteOpen + label + PUBLISH_COPY_PENDING.genericQuoteClose;
}

// ---- notes ---------------------------------------------------------------------------------------------
/** One route of the warning note (artboard 10): "מסלול {r} של {item} משמש גם ב'{kit}'". More than
 *  one kit is joined "ב'א', ב'ב' וב'ג'" (COPY-PENDING). */
export function sharedRoutePart(routeNumber: number, itemDesc: string, kits: readonly string[]): string {
  const quoted = kits.map((k) => "'" + k + "'");
  let where = quoted[quoted.length - 1] ?? "";
  if (quoted.length > 1) where = quoted.slice(0, -1).join(PUBLISH_COPY_PENDING.kitsComma) + PUBLISH_COPY_PENDING.kitsAnd + where;
  return "מסלול " + routeNumber + " של " + itemDesc + " משמש גם ב" + where;
}

/** The warning note (artboard 10): "השינויים יחולו גם מחוץ למארז הזה: {part}, ו{part}." — two
 *  routes as drawn; more are joined ", " with "ו" before the last (COPY-PENDING). On a single item
 *  route's screen the lead is COPY-PENDING. */
export function sharedOutsideText(parts: readonly string[], kitOnScreen: boolean): string {
  const lead = kitOnScreen ? "השינויים יחולו גם מחוץ למארז הזה: " : PUBLISH_COPY_PENDING.sharedLeadItemRoute;
  if (parts.length <= 1) return lead + (parts[0] ?? "") + ".";
  return lead + parts.slice(0, -1).join(PUBLISH_COPY_PENDING.routesComma) + ", ו" + parts[parts.length - 1] + ".";
}

/** "לפי גרסה {v}" — what items already on the way follow; on a first publish the COPY-PENDING
 *  "ללא שדות". */
function followPhrase(fromVersion: number): string {
  return fromVersion > 0 ? "לפי גרסה " + fromVersion : PUBLISH_COPY_PENDING.noVersionPhrase;
}

export type InfoNoteInput = {
  /** "גם לפריטים שטרם הגיעו…" is chosen. */
  pending: boolean;
  /** items_on_routes. */
  items: number;
  /** not_reached — the rows "not_reached" moves. */
  notReached: number;
  version: number;
  fromVersion: number;
};

/**
 * The info note (artboard 10 `infoText`), by the chosen scope:
 *   new:     "9 פריטים נמצאים כעת במסלולים האלה. הם ימשיכו לפי גרסה 4 עד סוף המסלול; פריטים
 *            שייקלטו מעכשיו יקבלו גרסה 5."
 *   pending: "9 פריטים נמצאים כעת במסלולים האלה. 4 מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה 5
 *            בעמדה הבאה שלהם; 5 האחרים ימשיכו לפי גרסה 4 עד סוף המסלול. פריטים שייקלטו מעכשיו
 *            יקבלו גרסה 5."
 * With nothing to move the pending note is the new one. 0 / 1 items, 1 to move or 1 left, all of
 * them moving and a first publish are COPY-PENDING forms.
 */
export function infoNoteText({ pending, items, notReached, version, fromVersion }: InfoNoteInput): string {
  const tail = "פריטים שייקלטו מעכשיו יקבלו גרסה " + version + ".";
  if (items <= 0) return PUBLISH_COPY_PENDING.noItemsHead + " " + tail;
  const head = items === 1 ? PUBLISH_COPY_PENDING.oneItemHead : items + " פריטים נמצאים כעת במסלולים האלה.";
  const follow = followPhrase(fromVersion);
  const moved = Math.min(Math.max(0, notReached), items);
  if (!pending || moved === 0) {
    const they = items === 1 ? PUBLISH_COPY_PENDING.oneItemContinues : "הם ימשיכו";
    return head + " " + they + " " + follow + " עד סוף המסלול; " + tail;
  }
  if (items === 1) return head + " " + PUBLISH_COPY_PENDING.onlyItemMovesPrefix + version + PUBLISH_COPY_PENDING.oneMovedSuffix + ". " + tail;
  const movedText = moved === 1
    ? PUBLISH_COPY_PENDING.oneMovedPrefix + version + PUBLISH_COPY_PENDING.oneMovedSuffix
    : moved + " מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה " + version + " בעמדה הבאה שלהם";
  const rest = items - moved;
  if (rest === 0) return head + " " + movedText + ". " + tail;
  const restText = (rest === 1 ? PUBLISH_COPY_PENDING.oneOtherContinues : rest + " האחרים ימשיכו") + " " + follow + " עד סוף המסלול";
  return head + " " + movedText + "; " + restText + ". " + tail;
}

// ---- "על מי תחול גרסה N" ---------------------------------------------------------------------------------
/** The radiogroup's label (artboard 10): "על מי תחול גרסה {v}". */
export function scopeLabelText(version: number): string {
  return "על מי תחול גרסה " + version;
}

/** The first card's line (artboard 10): "פריטים שכבר בדרך ממשיכים לפי גרסה {v-1} עד סוף המסלול". */
export function scopeNewSubText(fromVersion: number): string {
  return "פריטים שכבר בדרך ממשיכים " + followPhrase(fromVersion) + " עד סוף המסלול";
}

/** The second card's title (artboard 10): "גם לפריטים שטרם הגיעו לעמדה ששונתה · {n} פריטים". */
export function scopePendingTitleText(notReached: number): string {
  return "גם לפריטים שטרם הגיעו לעמדה ששונתה · " + (notReached === 1 ? PUBLISH_COPY_PENDING.oneItem : notReached + " פריטים");
}

/** The second card's line (artboard 10): "יעברו לגרסה {v} בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו". */
export function scopePendingSubText(version: number): string {
  return "יעברו לגרסה " + version + " בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו";
}

// ---- after publishing ------------------------------------------------------------------------------------
/** The Snackbar after a publish — COPY-PENDING: "גרסה {v} פורסמה". */
export function publishedSnackText(version: number): string {
  return PUBLISH_COPY_PENDING.publishedPrefix + version + PUBLISH_COPY_PENDING.publishedSuffix;
}
