import { routeOfTypeLabel } from "@/app/lib/station-fields/labels";
import { changesText, routesCountText, stationsText } from "./labels";
import type { PublishScope } from "./publishScopes";

/**
 * Strings of the publish dialog "פרסום גרסה N" (artboard 10, route-fields spec §5.11). Copied
 * character for character from the artboard's DOM and script ("·" is U+00B7); each count keeps the
 * artboard script's singular / plural rule. Shared screen words (the counts the header also uses,
 * the save / conflict notes) are imported from labels.ts, never re-typed.
 *
 * What artboard 10 does not draw — a singular it never shows, a first publish (no version to
 * replace), the dialog's loading and failure states, the Snackbar after a publish — lives in
 * PUBLISH_UNDRAWN_TEXT (spec "העיצוב סגור" rule 2, §10.4; wording approved on 2026-10-14).
 */

// ---- not drawn in artboard 10 ----------------------------------------------------------------------
/** Text artboard 10 never draws, worded here and approved on 2026-10-14. */
export const PUBLISH_UNDRAWN_TEXT = {
  // the Snackbar after a publish (spec §5.11: "Snackbar — הטקסט לא מצויר").
  publishedPrefix: "גרסה ",
  publishedSuffix: " פורסמה",
  // publish-preview failed (network, 5xx, an answer that is not an impact) — the
  // dialog has nothing to show (spec §10.4 "מצבי שגיאה"). The retry reuses artboard 11's "נסה שוב".
  previewFailed: "טעינת פרטי הפרסום נכשלה",
  // publish failed (network, 5xx, a refusal other than 409 / 422).
  publishFailed: "הפרסום נכשל. הטיוטה לא השתנתה.",
  // publish answered 409 DRAFT_CONFLICT — a draft changed since the preview (another
  // tab or admin; spec §3.4.3 step 2). The action reuses the header's "טען מחדש" and loads the
  // preview again.
  publishConflict: "הטיוטה עודכנה בינתיים במקום אחר — יש לטעון את הפרסום מחדש",
  // a first publish — no published version the items on the way follow. Replaces
  // "לפי גרסה {v-1}" in the scope card and the info note ("ימשיכו ללא שדות עד סוף המסלול"),
  // in the words of artboard 1's legend ("ללא שדות — העובד יראה את החלון הקבוע").
  noVersionPhrase: "ללא שדות",
  // the info note with no item on the routes (artboard 10 draws 9).
  noItemsHead: "אין כעת פריטים במסלולים האלה.",
  // the info note with a single item on the routes (artboard 10 draws 9).
  oneItemHead: "פריט אחד נמצא כעת במסלולים האלה.",
  oneItemContinues: "הוא ימשיך",
  // "גם לפריטים שטרם הגיעו…" with a single item to move — the card's tail and the info
  // note's clause (artboard 10 draws 4).
  oneItem: "פריט אחד",
  oneMovedPrefix: "אחד מהם, שטרם הגיע לעמדה ששונתה, יעבור לגרסה ",
  oneMovedSuffix: " בעמדה הבאה שלו",
  // the only item on the routes is the one that moves.
  onlyItemMovesPrefix: "הוא טרם הגיע לעמדה ששונתה, ולכן יעבור לגרסה ",
  // a single item stays on its version (artboard 10 draws "5 האחרים ימשיכו").
  oneOtherContinues: "האחר ימשיך",
  // a removed field filled in a single test (artboard 10 draws "מולא ב-38 בדיקות").
  filledOnce: "מולא בבדיקה אחת, הערכים יישמרו בהיסטוריה",
  // a field set that filled a single cell (artboard 10 draws "4 תאים מולאו").
  setFilledOneCell: "תא אחד מולא",
  // a field set whose name the screen could not read (archived, or the library could
  // not be loaded) — the line without the quoted name.
  setFilledUnnamed: " מערכת שדות",
  // a change artboard 10 has no wording for — rename, tone, notes mode, a removed
  // option, "חובה" turned off, a list link, a section, the note length, a removed step, the layout
  // (spec §5.11 table, last row): the "שונה" / "נמחק" badge and the field's (or station's) name in
  // quotes, until the wording is approved.
  genericQuote: "'",
  // a route that more than one other kit runs, and more than two such routes —
  // artboard 10 draws one kit per route and two routes ("ב'…', ומסלול … משמש גם ב'…'").
  kitsAnd: " וב",
  kitsComma: ", ב",
  routesComma: ", ",
} as const;

/** The scope cards and info-note clauses of "not_started" and "all" (publishScopes.PUBLISH_SCOPES):
 *  artboard 10 draws neither — proposed 2026-10-14, awaiting approval. */
export const SCOPE_UNDRAWN_TEXT = {
  // the first card: items that have not started their route (it replaces artboard 10's
  // "רק לפריטים חדשים (מומלץ)").
  notStartedTitle: "רק לפריטים שעוד לא התחילו את המסלול (מומלץ) · ",
  notStartedSubLead: "כולל מארזים שנקלטו ועוד לא נפתחו. ",
  // the third card: every unfinished item.
  allTitle: "לכל הפריטים, גם אלה שבבדיקה · ",
  allSub: "חלון שכבר פתוח ייטען מחדש עם השדות החדשים כשהעובד ישמור; תוצאות שכבר נשמרו לא ישתנו",
  // the info note under "not_started" — artboard 10's "pending" sentence with this card's reason.
  notStartedMoved: " מהם, שעוד לא התחילו את המסלול, יעברו לגרסה ",
  notStartedOneMovedPrefix: "אחד מהם, שעוד לא התחיל את המסלול, יעבור לגרסה ",
  notStartedOnlyItemPrefix: "הוא עוד לא התחיל את המסלול, ולכן יעבור לגרסה ",
  // the info note under "all".
  allMovedPrefix: "כולם יעברו לגרסה ",
  allMovedSuffix: ", גם פריטים שכבר בבדיקה",
  allOnlyItemPrefix: "הוא יעבור לגרסה ",
  allOnlyItemSuffix: ", גם אם הוא כבר בבדיקה",
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
} as const;

/** A change row's round badge: its title and the glyph's aria-label (artboard 10 `KIND`). */
export const CHANGE_BADGE_TEXT = { add: "נוסף", edit: "שונה", del: "נמחק" } as const;

// ---- head ----------------------------------------------------------------------------------------------
/** The title (artboard 10), with the route as the route combobox names it. */
export function publishTitleText(version: number, routeText: string): string {
  return "פרסום גרסה " + version + " · " + routeText;
}

/** The primary button (artboard 10). */
export function publishButtonText(version: number): string {
  return "פרסם גרסה " + version;
}

/** The count tags (artboard 10): changes, stations, routes — the singulars the script's and the
 *  screen's (undrawn). */
export function countTagsText(totals: { changes: number; stations: number; routes: number }): string[] {
  return [changesText(totals.changes), stationsText(totals.stations), routesCountText(totals.routes)];
}

/** Beside the tags (artboard 10); null on a first publish (no version to replace — the dialog leaves
 *  it out). */
export function replacesVersionText(fromVersion: number): string | null {
  return fromVersion > 0 ? "מחליפה את גרסה " + fromVersion + " המפורסמת" : null;
}

// ---- "מה השתנה" -------------------------------------------------------------------------------------------
/** A group's title (artboard 10): the station and the item, the station alone on the kit's own route. */
export function groupTitleText(station: string, item: string | null): string {
  return item ? station + " · " + item : station;
}

/** The group of a step's layout (artboard 10). */
export function layoutGroupTitleText(station: string): string {
  return "פריסת החלון · " + station;
}

/** Artboard 10. */
export function fieldAddedText(label: string): string {
  return "נוסף '" + label + "'";
}

/** Artboard 10. */
export function optionAddedText(field: string, option: string): string {
  return "'" + field + "': נוספה אפשרות '" + option + "'";
}

/** Artboard 10. */
export function requiredOnText(field: string): string {
  return "'" + field + "' סומן כחובה";
}

/** Artboard 10. */
export function fieldRemovedText(label: string): string {
  return "נמחק '" + label + "'";
}

/** The warning after a removed field (artboard 10); one test is undrawn; nothing filled, no warning. */
export function filledWarnText(filled: number): string | null {
  if (filled <= 0) return null;
  return filled === 1 ? PUBLISH_UNDRAWN_TEXT.filledOnce : "מולא ב-" + filled + " בדיקות, הערכים יישמרו בהיסטוריה";
}

/** Cells a field set filled (artboard 10). One cell, and a set whose name is unknown, are undrawn. */
export function setFilledText(cells: number, setName: string | null): string {
  const head = cells === 1 ? PUBLISH_UNDRAWN_TEXT.setFilledOneCell : cells + " תאים מולאו";
  return setName != null ? head + " מהערכה '" + setName + "'" : head + PUBLISH_UNDRAWN_TEXT.setFilledUnnamed;
}

/** A change without its own wording (undrawn, spec §5.11): the name in quotes. */
export function genericChangeText(label: string): string {
  return PUBLISH_UNDRAWN_TEXT.genericQuote + label + PUBLISH_UNDRAWN_TEXT.genericQuote;
}

// ---- notes ---------------------------------------------------------------------------------------------
/** One route of the warning note (artboard 10). More than one kit is joined (undrawn). */
export function sharedRoutePart(routeNumber: number, itemDesc: string, kits: readonly string[]): string {
  const quoted = kits.map((k) => "'" + k + "'");
  let where = quoted[quoted.length - 1] ?? "";
  if (quoted.length > 1) where = quoted.slice(0, -1).join(PUBLISH_UNDRAWN_TEXT.kitsComma) + PUBLISH_UNDRAWN_TEXT.kitsAnd + where;
  return routeOfTypeLabel(routeNumber, itemDesc) + " משמש גם ב" + where;
}

/** The warning note (artboard 10): two routes as drawn; more are joined with "ו" before the last
 *  (undrawn). */
export function sharedOutsideText(parts: readonly string[]): string {
  const lead = "השינויים יחולו גם מחוץ למארז הזה: ";
  if (parts.length <= 1) return lead + (parts[0] ?? "") + ".";
  return lead + parts.slice(0, -1).join(PUBLISH_UNDRAWN_TEXT.routesComma) + ", ו" + parts[parts.length - 1] + ".";
}

/** What items already on the way follow; on a first publish the undrawn noVersionPhrase. */
function followPhrase(fromVersion: number): string {
  return fromVersion > 0 ? "לפי גרסה " + fromVersion : PUBLISH_UNDRAWN_TEXT.noVersionPhrase;
}

export type InfoNoteInput = {
  /** The chosen scope. */
  scope: PublishScope;
  /** items_on_routes. */
  items: number;
  /** The rows the chosen scope moves (publishModel.scopeCount). */
  moved: number;
  version: number;
  fromVersion: number;
};

/** The moving part of the note, in the chosen scope's words. */
function movedClause(scope: PublishScope, moved: number, version: number): string {
  const S = SCOPE_UNDRAWN_TEXT;
  switch (scope) {
    case "not_started":
      return moved === 1 ? S.notStartedOneMovedPrefix + version : moved + S.notStartedMoved + version;
    case "not_reached":
      return moved === 1
        ? PUBLISH_UNDRAWN_TEXT.oneMovedPrefix + version + PUBLISH_UNDRAWN_TEXT.oneMovedSuffix
        : moved + " מהם, שטרם הגיעו לעמדה ששונתה, יעברו לגרסה " + version + " בעמדה הבאה שלהם";
    case "all":
      return S.allMovedPrefix + version + S.allMovedSuffix;
  }
}

/** The note when the only item on the routes is the one that moves. */
function onlyItemClause(scope: PublishScope, version: number): string {
  const S = SCOPE_UNDRAWN_TEXT;
  switch (scope) {
    case "not_started": return S.notStartedOnlyItemPrefix + version;
    case "not_reached": return PUBLISH_UNDRAWN_TEXT.onlyItemMovesPrefix + version + PUBLISH_UNDRAWN_TEXT.oneMovedSuffix;
    case "all": return S.allOnlyItemPrefix + version + S.allOnlyItemSuffix;
  }
}

/**
 * The info note (artboard 10 `infoText`), by the chosen scope and how many items it moves. Artboard
 * 10 draws two forms: nothing moves, and "not_reached" moves some; "not_started" and "all" say the
 * same with their own reason (SCOPE_UNDRAWN_TEXT). 0 / 1 items, 1 to move or 1 left, all of them
 * moving and a first publish are undrawn forms.
 */
export function infoNoteText({ scope, items, moved: rawMoved, version, fromVersion }: InfoNoteInput): string {
  const tail = "פריטים שייקלטו מעכשיו יקבלו גרסה " + version + ".";
  if (items <= 0) return PUBLISH_UNDRAWN_TEXT.noItemsHead + " " + tail;
  const head = items === 1 ? PUBLISH_UNDRAWN_TEXT.oneItemHead : items + " פריטים נמצאים כעת במסלולים האלה.";
  const follow = followPhrase(fromVersion);
  const moved = Math.min(Math.max(0, rawMoved), items);
  if (moved === 0) {
    const they = items === 1 ? PUBLISH_UNDRAWN_TEXT.oneItemContinues : "הם ימשיכו";
    return head + " " + they + " " + follow + " עד סוף המסלול; " + tail;
  }
  if (items === 1) return head + " " + onlyItemClause(scope, version) + ". " + tail;
  const movedText = movedClause(scope, moved, version);
  const rest = items - moved;
  if (rest === 0) return head + " " + movedText + ". " + tail;
  const restText = (rest === 1 ? PUBLISH_UNDRAWN_TEXT.oneOtherContinues : rest + " האחרים ימשיכו") + " " + follow + " עד סוף המסלול";
  return head + " " + movedText + "; " + restText + ". " + tail;
}

// ---- the scope radiogroup -------------------------------------------------------------------------------
/** The radiogroup's label (artboard 10). */
export function scopeLabelText(version: number): string {
  return "על מי תחול גרסה " + version;
}

/** The item count after a card's title. */
function itemsCountText(n: number): string {
  return n === 1 ? PUBLISH_UNDRAWN_TEXT.oneItem : n + " פריטים";
}

/** The first card's title (undrawn). */
export function scopeNotStartedTitleText(notStarted: number): string {
  return SCOPE_UNDRAWN_TEXT.notStartedTitle + itemsCountText(notStarted);
}

/** The first card's line: what it includes, then artboard 10's sentence on the items on the way. */
export function scopeNotStartedSubText(fromVersion: number): string {
  return SCOPE_UNDRAWN_TEXT.notStartedSubLead + "פריטים שכבר בדרך ממשיכים " + followPhrase(fromVersion) + " עד סוף המסלול";
}

/** The second card's title (artboard 10). */
export function scopePendingTitleText(notReached: number): string {
  return "גם לפריטים שטרם הגיעו לעמדה ששונתה · " + itemsCountText(notReached);
}

/** The second card's line (artboard 10). */
export function scopePendingSubText(version: number): string {
  return "יעברו לגרסה " + version + " בעמדה הבאה שלהם; תוצאות שכבר נשמרו לא ישתנו";
}

/** The third card's title (undrawn); its line is SCOPE_UNDRAWN_TEXT.allSub. */
export function scopeAllTitleText(items: number): string {
  return SCOPE_UNDRAWN_TEXT.allTitle + itemsCountText(items);
}

// ---- after publishing ------------------------------------------------------------------------------------
/** The toast after a publish (undrawn). */
export function publishedSnackText(version: number): string {
  return PUBLISH_UNDRAWN_TEXT.publishedPrefix + version + PUBLISH_UNDRAWN_TEXT.publishedSuffix;
}
