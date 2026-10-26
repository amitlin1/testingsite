import type { ComponentKind } from "./schema";

/**
 * Strings of the popup templates (docs/popup-templates/PLAN.md). No artboard draws the template
 * screen yet: every word here is our own and awaits approval. The worker-facing defaults repeat
 * today's popups word for word (tests-popups/PhotoStation.tsx, VerdictStation.tsx, stationKit.tsx),
 * so a seeded template looks exactly like the popup it replaces.
 */

/** A component's name in the catalog and the editor. */
export const COMPONENT_NAME: Record<ComponentKind, string> = {
  sku_scan: "סריקת מק״ט יצרן",
  message: "הודעת מערכת",
  photo: "צילום",
  weight: "שקילה מול ייחוס",
  route_fields: "שדות המסלול",
  verdict: "פסק דין",
};

/** Worker-facing defaults — today's popups' own words. */
export const TEMPLATE_DEFAULTS = {
  skuStepTitle: "סריקת מק״ט יצרן",
  skuStepDesc: "סרוק את מק״ט היצרן של המוצר לזיהוי פריט הייחוס.",
  verdictQuestion: "בדיקה תקינה?",
  finishLabel: "סיום בדיקת {עמדה}",
  photoTitle: "תיעוד בתמונות",
  noReference: "לא נמצא פריט ייחוס — נא להודיע לגורם אחראי",
} as const;

/** Content rules (lintPopupTemplate). Every one blocks a save. */
export const TEMPLATE_LINT_TEXT = {
  stepsEmpty: "לחלון צריך להיות לפחות שלב אחד",
  stepsTooMany: "בחלון יכולים להיות עד 6 שלבים",
  stepEmpty: "בשלב אין אף רכיב",
  stepTitleEmpty: "לשלב חסרה כותרת",
  finishLabelEmpty: "חסרה תווית לכפתור הסיום",
  skuDuplicate: "בחלון יכולה להיות סריקת מק״ט אחת בלבד",
  skuNotFirst: "סריקת המק״ט חייבת להיות לבד, בשלב הראשון",
  verdictMissing: "בכל חלון חייב להיות פסק דין",
  verdictDuplicate: "בחלון יכול להיות פסק דין אחד בלבד",
  verdictNotLast: "פסק הדין חייב להיות הרכיב האחרון בשלב האחרון",
  verdictQuestionEmpty: "לפסק הדין חסרה שאלה",
  routeFieldsDuplicate: "שדות המסלול יכולים להופיע במקום אחד בלבד",
  needsReference: "רכיב שמשתמש בפריט הייחוס צריך סריקת מק״ט עם חיפוש ייחוס לפניו",
  messageEmpty: "הודעת המערכת ריקה",
  photoTitleEmpty: "לרכיב הצילום חסרה כותרת",
  photoTooMany: "בחלון יכולים להיות עד 8 רכיבי צילום",
  photoCodeDuplicate: "שני רכיבי צילום משתמשים באותה קבוצת תמונות",
  tolerance: "הסטייה המותרת צריכה להיות בין 0 ל-100 אחוז",
} as const;
