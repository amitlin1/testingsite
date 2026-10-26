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
  checklist: "רשימת סימון",
  notes: "הערות",
  contents: "תכולה וסריאליים",
  items: "פריטים במארז",
  labels: "מדבקות",
  arrival: "פריטים ואריזה",
};

/** Worker-facing defaults — today's popups' own words. */
export const TEMPLATE_DEFAULTS = {
  skuStepTitle: "סריקת מק״ט יצרן",
  skuStepDesc: "סרוק את מק״ט היצרן של המוצר לזיהוי פריט הייחוס.",
  verdictQuestion: "בדיקה תקינה?",
  finishLabel: "סיום בדיקת {עמדה}",
  photoTitle: "תיעוד בתמונות",
  noReference: "לא נמצא פריט ייחוס — נא להודיע לגורם אחראי",
  // The package wizards' own words (PackageOpenWizard / PackageCloseWizard), so a template made
  // "מהחלון של היום" reads exactly like them.
  boxQuestion: "האריזה תקינה?",
  itemQuestion: "הפריט תקין?",
  openFinish: "הדפס וסיים",
  closeFinish: "סגור מארז",
  packNote: "הערות אריזה",
  packChecks: ["כל הפריטים שסומנו נמצאים בקופסה", "האריזה סגורה ותקינה", "מדבקת המארז קריאה"],
  boxPhotoMessage: "נא לצלם את הקופסה בדיוק לפי תמונות הייחוס.",
  itemPhotoMessage: "נא לצלם את הפריט בדיוק לפי תמונות הייחוס.",
  weighMessage: "נא לשקול את הפריט ולהזין את המשקל שנמדד.",
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
  // the package base (PLAN.md §5)
  roleMissing: "לתבנית של עמדה ברמת מארז חסר תפקיד: פתיחה או סגירה",
  roleOnItem: "לתבנית של עמדת פריט אין תפקיד של מארז ואין תהליך לכל פריט",
  kindNotAllowed: (name: string) => `הרכיב "${name}" לא מתאים כאן`,
  systemMissing: (name: string) => `בתבנית הזו חייב להיות "${name}"`,
  systemNotAlone: (name: string) => `"${name}" חייב להיות לבד בשלב שלו`,
  systemOrder: "הסדר במארז: תכולה וסריאליים, אחריה הפריטים, ואחריהם המדבקות",
  itemFlowEmpty: "בתהליך לכל פריט חייב להיות לפחות רכיב אחד",
  skuNotFirstInFlow: "בתהליך לכל פריט, סריקת המק״ט חייבת להיות ראשונה",
  verdictNotLastInStep: "פסק הדין חייב להיות הרכיב האחרון בשלב שלו",
  checklistTitleEmpty: "לרשימת הסימון חסרה כותרת",
  checklistEmpty: "ברשימת הסימון אין שורות",
  checklistItemEmpty: "בשורה ברשימת הסימון חסר טקסט",
  notesLabelEmpty: "לשדה ההערות חסרה כותרת",
} as const;
