import { ApiError } from "@/lib/api/client";

/**
 * The one rule for what a screen shows when a call failed.
 *
 * Hebrew is the test of "written for the worker": the server's refusals that a worker should read
 * are Hebrew ("לא ניתן לערוך משלוח שנשלח"), while the technical ones are English ("Item route not
 * found", "Forbidden") and so is what the browser throws when no answer came ("Failed to fetch").
 *
 * - The server answered with a Hebrew `error`: that text.
 * - The server answered otherwise (English, nothing, not JSON): the screen's own `fallback`.
 * - No answer came: the screen's own `noAnswer` text (its fallback when it has none) — unless our
 *   own code threw a Hebrew message on the way, which is shown as it is.
 */
const WRITTEN_FOR_PEOPLE = /[\u0590-\u05FF]/;

const forPeople = (text: unknown): text is string => typeof text === "string" && WRITTEN_FOR_PEOPLE.test(text);

/** The screens' words for "no answer came". */
export const NO_CONNECTION_TEXT = "שגיאה בתקשורת";
export const NO_SERVER_TEXT = "שגיאה בתקשורת עם השרת";

/** sendJson's own words when the server said nothing — the fallback of the screens that showed them. */
export const ACTION_FAILED_TEXT = "הפעולה נכשלה";

export function failureText(e: unknown, fallback: string, noAnswer: string = fallback): string {
  if (e instanceof ApiError) return forPeople(e.body.error) ? e.body.error : fallback;
  return e instanceof Error && forPeople(e.message) ? e.message : noAnswer;
}
