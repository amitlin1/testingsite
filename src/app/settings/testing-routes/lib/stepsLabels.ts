import { STEPS_PARTS_TEXT, routeNumberText } from "./labels";

/**
 * Strings of the "שלבי המסלול" editor and of the page shell's own states. The parts list, the title
 * and the notices are in labels.ts (STEPS_PARTS_TEXT).
 */

export const STEPS_EDITOR_TEXT = {
  /** The tab with no route chosen, under NO_ROUTE_TEXT. */
  noRouteHint: "שלבי המסלול יופיעו כאן לעריכה.",
  save: "שמור",
  saved: "מסלול נשמר בהצלחה",
  /** A save refused without the server's own reason. */
  saveFailed: "שמירת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.",
  /** A save that failed with no message at all. */
  saveFailedRetry: "שמירת המסלול נכשלה. נסה שוב.",
  loadFailed: "טעינת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.",
  stepsLabel: "שלבי המסלול · לפי הסדר",
  loadingSteps: "טוען שלבים",
  noSteps: "אין שלבים. הוסף עמדה למסלול.",
  addStepLabel: "הוסף שלב (סוג עמדה)",
  addStepPlaceholder: "בחר סוג עמדה…",
  addStep: "הוסף שלב",
} as const;

/** A part's sub-line while its route does not exist yet. */
export function routeNotCreatedText(routeNumber: number): string {
  return routeNumberText(routeNumber) + " · " + STEPS_PARTS_TEXT.notCreated;
}

export function moveStepUpTitle(station: string): string {
  return "הקדם את " + station;
}

export function moveStepDownTitle(station: string): string {
  return "אחר את " + station;
}

export function removeStepTitle(station: string): string {
  return "הסר את " + station + " מהמסלול";
}

/** The page shell. */
export const PAGE_TEXT = {
  /** The item types or the station types (or the route list) could not be read. */
  optionsFailed: "טעינת סוגי הפריטים והעמדות נכשלה, ולכן אי אפשר לבחור מסלול. בדוק את החיבור לשרת ונסה שוב.",
  /** The map's skeleton (the old page's route skeleton's). */
  loadingRoute: "טוען מסלול",
} as const;
