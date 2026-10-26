import type { TemplateComponent } from "@/app/lib/popup-templates/schema";
import { COMPONENT_NAME } from "@/app/lib/popup-templates/labels";

/**
 * Strings of the template editor (/settings/popup-templates, docs/popup-templates/PLAN.md step 1.6).
 * No artboard draws this screen: every word is our own and awaits approval.
 */
export const EDITOR_TEXT = {
  title: "תבניות חלון",
  subtitle: "איך נראה חלון הבדיקה בכל סוג עמדה: אילו שלבים יש בו ואילו רכיבים בכל שלב. שדות הבדיקה עצמם מוגדרים בעמוד מסלולי בדיקה.",
  typesTitle: "סוגי עמדה",
  pickType: "בחר סוג עמדה מהרשימה",
  pickTypeSub: "התבנית שלו תוצג כאן לעריכה.",
  rowTemplate: (v: number) => `תבנית · גרסה ${v}`,
  rowCode: "החלון של היום",
  rowPackage: "ברמת מארז · בשלב הבא",
  noTemplate: "לסוג העמדה הזה אין תבנית, ולכן הוא פותח את החלון של היום.",
  createFromCode: "צור מהחלון של היום",
  createBlank: "צור תבנית ריקה",
  packageLater: "תבניות לעמדות ברמת מארז (פתיחה וסגירה של מארז) יגיעו בשלב הבא. עד אז הן פותחות את אשפי המארז של היום.",
  version: (v: number) => `גרסה ${v}`,
  newTemplate: "תבנית חדשה, עוד לא נשמרה",
  dirty: "לא נשמר",
  savedBy: (who: string | null) => (who ? `נשמר על ידי ${who}` : ""),
  preview: "תצוגה מקדימה",
  discard: "בטל שינויים",
  save: "שמור",
  deleteTemplate: "חזור לחלון של היום",
  deleteTitle: "לחזור לחלון של היום?",
  deleteMessage: "התבנית תימחק, וסוג העמדה יפתח שוב את החלון שהיה לו לפני התבנית. תמונות הייחוס של רכיבי הצילום נשארות. הגרסאות הקודמות נשמרות.",
  deleteConfirm: "מחק את התבנית",
  leaveTitle: "לעבור בלי לשמור?",
  leaveMessage: "השינויים בתבנית הזו לא נשמרו ויאבדו.",
  leaveConfirm: "עבור בלי לשמור",
  issuesTitle: "יש לתקן לפני השמירה:",
  finishLabel: "תווית כפתור הסיום",
  variables: "משתנים:",
  step: (n: number) => `שלב ${n}`,
  stepTitle: "כותרת השלב",
  stepDesc: "תיאור (אופציונלי)",
  stepEmpty: "אין רכיבים בשלב הזה.",
  addStep: "הוסף שלב",
  addComponent: "הוסף:",
  moveUp: (what: string) => `הזז למעלה: ${what}`,
  moveDown: (what: string) => `הזז למטה: ${what}`,
  remove: (what: string) => `הסר: ${what}`,
  settings: (what: string) => `הגדרות: ${what}`,
  loadFailed: "טעינת התבנית נכשלה. בדוק את החיבור לשרת ונסה שוב.",
  listFailed: "טעינת סוגי העמדה נכשלה. בדוק את החיבור לשרת ונסה שוב.",
  retry: "נסה שוב",
  saved: "התבנית נשמרה",
  deleted: "התבנית נמחקה. סוג העמדה פותח את החלון של היום.",
  conflict: "מישהו אחר שמר את התבנית בזמן שערכת אותה. טען אותה מחדש כדי לראות את הגרסה שלו.",
  reload: "טען מחדש",
  saveFailed: "שמירת התבנית נכשלה. נסה שוב.",
  previewNote: "תצוגה מקדימה — שום דבר לא נשמר.",
  previewItem: "פריט לדוגמה",
} as const;

/** Settings of each component, under its row. */
export const COMPONENT_SETTINGS_TEXT = {
  required: "חובה",
  carryLast: "להתחיל מהמק״ט שנסרק בעמדה הקודמת",
  lookupReference: "לחפש את פריט הייחוס לפי המק״ט (תמונות ייחוס ומשקל)",
  messageText: "טקסט ההודעה",
  photoTitle: "כותרת",
  photoMin: "מינימום צילומים",
  photoMinHelp: "0 = הצילום אופציונלי",
  showReference: "להציג את תמונות הייחוס של הרכיב הזה",
  photoGroup: "תמונות הייחוס של הרכיב הזה מועלות בעמוד פריטי הייחוס, תחת הכותרת שלו.",
  tolerance: "סטייה מותרת (±%)",
  routeFields: "כאן יופיעו שדות הבדיקה שמוגדרים לעמדה בעמוד מסלולי בדיקה.",
  question: "השאלה",
  noteMax: "אורך מרבי להערה (כשיש שדות)",
} as const;

/** A component's one-line summary in its row. */
export function componentSummary(c: TemplateComponent): string {
  switch (c.kind) {
    case "sku_scan":
      return [c.required ? "חובה" : "רשות", c.carry_last ? "ממשיך מהעמדה הקודמת" : null, c.lookup_reference ? "מחפש פריט ייחוס" : null].filter(Boolean).join(" · ");
    case "message":
      return c.text.trim() ? (c.text.length > 70 ? c.text.slice(0, 70) + "…" : c.text) : "(ריקה)";
    case "photo":
      return [c.title || "(ללא כותרת)", c.min > 0 ? `לפחות ${c.min}` : "אופציונלי", c.show_reference ? "עם תמונות ייחוס" : null].filter(Boolean).join(" · ");
    case "weight":
      return `סטייה מותרת ±${c.tolerance_pct}% · ${c.required ? "חובה" : "רשות"}`;
    case "route_fields":
      return "מעמוד מסלולי בדיקה";
    case "verdict":
      return c.question || "(ללא שאלה)";
    case "checklist":
      return `${c.title || "(ללא כותרת)"} · ${c.items.length === 1 ? "שורה אחת" : `${c.items.length} שורות`}`;
    case "notes":
      return c.label || "(ללא כותרת)";
    case "contents":
    case "items":
    case "labels":
    case "arrival":
      return "חלק קבוע של אשף המארז";
  }
}

/** "+ צילום" — the catalog button of a kind. */
export const addKindText = (c: TemplateComponent["kind"]) => "+ " + COMPONENT_NAME[c];
