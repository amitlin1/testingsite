import type { ForkError } from "./useFork";

/**
 * Strings of "צור מסלול נפרד למארז הזה" (route-fields spec §3.2.1, §5.5.2 א, decision 4; artboard 2):
 * the link at the end of the shared notice is drawn, character for character from artboard 2's DOM.
 * Its confirm dialog and every outcome of the fork are not drawn (spec §5.5.2 "דיאלוג האישור לא
 * מצויר", §10.4 "אישורים: … 'צור מסלול נפרד'") — they live in FORK_COPY_PENDING until approved (spec
 * "העיצוב סגור" rule 2), listed in the PR under "טקסט לאישור".
 */

/** Drawn text (artboard 2). */
export const FORK_TEXT = {
  /** The link after "שינוי כאן יחול בשניהם." — and the dialog's confirm button, which repeats the
   *  action as the editor's "נקה את התא" confirm does. */
  link: "צור מסלול נפרד למארז הזה",
} as const;

/** Drafts for text artboard 2 never draws. Do not treat as approved copy. */
export const FORK_COPY_PENDING = {
  // COPY-PENDING: the confirm dialog's title (spec §5.5.2: "דיאלוג האישור לא מצויר").
  title: "ליצור מסלול נפרד למארז הזה?",
  // COPY-PENDING: the dialog's message — what the fork does (spec §3.2.1): a new route of the item
  // with the same stations and fields, this kit's line moves to it, the other kits and the items
  // already on the way stay, and the copied fields reach the stations only once published (the new
  // route starts at fields_version 0). Joined by forkConfirmMessage.
  newRoutePrefix: "ייווצר מסלול חדש של ",
  newRouteMiddle: " עם אותן עמדות ואותם שדות, ו",
  newRouteSuffix: " יעבור אליו.",
  othersStayOne: " ימשיך במסלול ",
  othersStayMany: " ימשיכו במסלול ",
  kitsJoin: ", ",
  tail: "פריטים שכבר בדרך יישארו במסלול הנוכחי. השדות במסלול החדש יגיעו לעמדות אחרי פרסום.",
  // COPY-PENDING: the edits of the cell could not be saved before the fork (autosave failed or the
  // draft is in conflict), so nothing was copied — the fork would have copied an older draft.
  unsaved: "השינויים האחרונים במסלול עדיין לא נשמרו, ולכן לא נוצר מסלול נפרד. נסה שוב.",
  // COPY-PENDING: 409 ITEM_ROUTE_SHAPE / PACKAGE_ROUTE_SHAPE — the server's reason (route-rules.ts'
  // Hebrew, the intake's own words) follows the prefix.
  shapePrefix: "לא ניתן ליצור מסלול נפרד: ",
  // COPY-PENDING: the screen is behind the server — the kit's line runs another route by now (a
  // second tab, a second click), the line or the route is gone (409 LINE_NOT_ON_ROUTE, 400
  // KIT_LINE_NOT_FOUND, 404). Closing the dialog then reloads the map (SharedRouteFork.onStale).
  stale: "תכולת המארז או המסלול השתנו בינתיים, ולכן לא נוצר מסלול נפרד.",
  // COPY-PENDING: network, 5xx, or any other refusal. "נסה שוב" is artboard 11's.
  failed: "יצירת המסלול הנפרד נכשלה. נסה שוב.",
} as const;

export type ForkMessageInput = {
  /** The item type whose route is forked ("מסך"). */
  item: string;
  /** The kit on screen ("מארז עמדת עבודה"). */
  kit: string;
  /** The other kits that keep the route ("מארז ציוד היקפי"). */
  otherKits: readonly string[];
  /** The route they keep. */
  routeNumber: number;
};

/** The confirm dialog's message (COPY-PENDING): "ייווצר מסלול חדש של {item} עם אותן עמדות ואותם
 *  שדות, ו{kit} יעבור אליו. {kits} ימשיך/ימשיכו במסלול {r}. פריטים שכבר בדרך …". */
export function forkConfirmMessage({ item, kit, otherKits, routeNumber }: ForkMessageInput): string {
  const P = FORK_COPY_PENDING;
  const head = P.newRoutePrefix + item + P.newRouteMiddle + kit + P.newRouteSuffix;
  const stay = otherKits.length === 0
    ? ""
    : " " + otherKits.join(P.kitsJoin) + (otherKits.length === 1 ? P.othersStayOne : P.othersStayMany) + routeNumber + ".";
  return head + stay + " " + P.tail;
}

/** The dialog's error line for a fork that did not happen (COPY-PENDING): a shape refusal carries
 *  the server's reason. */
export function forkErrorText(error: ForkError): string {
  switch (error.kind) {
    case "unsaved":
      return FORK_COPY_PENDING.unsaved;
    case "shape":
      return error.reason ? FORK_COPY_PENDING.shapePrefix + error.reason : FORK_COPY_PENDING.failed;
    case "stale":
      return FORK_COPY_PENDING.stale;
    case "failed":
      return FORK_COPY_PENDING.failed;
  }
}
