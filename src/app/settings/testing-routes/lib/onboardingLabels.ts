import type { FieldsMapModel } from "./mapModel";
import { BULK_TEXT, openKitText, sharedFilledText } from "./labels";

/**
 * Strings of the onboarding card of a route that holds no fields of its own (route-fields spec
 * §5.12; artboard 11, top), copied character for character from artboard 11's DOM ("·" is U+00B7,
 * "…" is U+2026). The info bar's sentence and its link are labels.ts's sharedFilledText /
 * openKitText (their singular is undrawn there); the apply-set button is the selection bar's
 * (artboards 1, 11 write it the same) — imported, never re-typed.
 *
 * Artboard 11's outlined "copy from another route" button is not drawn here: its dialog is not
 * drawn (spec §10.4).
 */

/** The card (artboard 11). */
export const ONBOARDING_TEXT = {
  title: "עדיין לא הוגדרו שדות למסלול הזה",
  body: "כל עוד אין שדות, כל עמדה מציגה לעובד את החלון הקבוע של היום. שום דבר לא משתנה בעמדות עד שתפרסמו.",
  /** The <ol>'s aria-label. */
  stepsLabel: "שלושה צעדים",
  /** Primary: the cell editor on the first relevant cell. */
  start: "התחל בעמדה הראשונה",
  /** Ghost: the "החלת ערכת שדות" dialog (artboard 9). */
  applySet: BULK_TEXT.applySet,
} as const;

/** The three steps, in order (artboard 11): the number in the circle is the place in this list. */
export const ONBOARDING_STEPS: readonly { title: string; line: string }[] = [
  { title: "בחרו עמדה ופריט", line: "לחיצה על תא במפה" },
  { title: "הוסיפו שורות בדיקה", line: "שם · 4 אפשרויות · הערות" },
  { title: "פרסמו", line: "העובדים יראו את השדות בחלון העמדה" },
];

/** One sentence of the info bar under the card, with its "פתח את {kit}" links. */
export type SharedFilledLine = {
  /** The map row the sentence is about (MapRow.key). */
  key: string;
  /** labels.sharedFilledText. */
  text: string;
  /** labels.openKitText for each other kit that runs the row's route — the map of that kit. */
  links: { packageTypeId: number; text: string }[];
};

/**
 * The info bar's sentences (artboard 11): one per template line whose item route other kits run
 * and have already filled (FieldsMapModel.sharedFilled), in map order. Artboard 11 draws one line
 * and one kit; several lines get a sentence each in the same words, and a route two lines share is
 * told once. [] = no bar.
 */
export function sharedFilledLines(model: Pick<FieldsMapModel, "sharedFilled" | "rows">): SharedFilledLine[] {
  const seen = new Set<string>();
  const out: SharedFilledLine[] = [];
  for (const e of model.sharedFilled) {
    if (e.cells <= 0 || e.kits.length === 0) continue;
    const routeId = model.rows.find((r) => r.key === e.rowKey)?.routeId;
    const routeKey = routeId != null ? "route:" + routeId : "row:" + e.rowKey;
    if (seen.has(routeKey)) continue;
    seen.add(routeKey);
    out.push({
      key: e.rowKey,
      text: sharedFilledText(e.cells, e.itemTypeDesc, e.routeNumber, e.kits.map((k) => k.desc)),
      links: e.kits.map((k) => ({ packageTypeId: k.package_type_id, text: openKitText(k.desc) })),
    });
  }
  return out;
}
