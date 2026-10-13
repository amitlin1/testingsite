import type { FieldsSubmissionCode } from "@/app/lib/station-fields/submit";

/**
 * The station-field errors POST /api/testing/results answers with (route-fields D5, spec §4.12):
 * { error: <message>, code, missing? }. Two shapes reach a popup:
 * - VerdictStation / PhotoStation / PopUpTestDialog get the Error that page.tsx's
 *   handleSubmitTestResult throws, carrying the body's `code`;
 * - the package wizards post themselves and read the JSON body ({ error, code }).
 * Every helper here takes either.
 */

/** Each code, with whether its message is written for the worker. FIELDS_INVALID and
 *  DETAILS_TOO_LARGE carry a technical English message (a client bug), so a popup shows its own
 *  generic save error for them instead (fieldsErrorText). */
const FIELDS_ERRORS = {
  FIELDS_SCHEMA_MISMATCH: { status: 409, workerMessage: true },   // reload the config, keep the drafts
  FIELDS_INVALID: { status: 400, workerMessage: false },
  NOTE_TOO_LONG: { status: 400, workerMessage: true },
  FIELDS_INCOMPLETE: { status: 422, workerMessage: true },        // the finish-gate text (artboard 14)
  DETAILS_TOO_LARGE: { status: 413, workerMessage: false },
} as const satisfies Record<FieldsSubmissionCode, { status: number; workerMessage: boolean }>;

export type FieldsErrorCode = keyof typeof FIELDS_ERRORS;

/** Every code of D5, in its order. */
export const FIELDS_ERROR_CODES = Object.keys(FIELDS_ERRORS) as readonly FieldsErrorCode[];

/** The Error page.tsx throws for a field error: the body's message, and its code. */
export type FieldsError = Error & { code: FieldsErrorCode };

export function isFieldsErrorCode(code: unknown): code is FieldsErrorCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(FIELDS_ERRORS, code);
}

/** The `code` of an Error or of a response body, when it is a string. */
function codeOf(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** True for an Error whose `code` is one of FIELDS_ERROR_CODES. */
export function isFieldsError(e: unknown): e is FieldsError {
  return e instanceof Error && isFieldsErrorCode(codeOf(e));
}

/**
 * The text a popup shows after a failed save: the server's own message when it is written for the
 * worker (FIELDS_INCOMPLETE, FIELDS_SCHEMA_MISMATCH, NOTE_TOO_LONG), otherwise `fallback` — the
 * popup's existing generic error (e.g. "שגיאה בשמירת הבדיקה"). Takes an Error (its message) or a
 * response body (its `error`).
 */
export function fieldsErrorText(e: unknown, fallback: string): string {
  const code = codeOf(e);
  if (!isFieldsErrorCode(code) || !FIELDS_ERRORS[code].workerMessage) return fallback;
  const message = e instanceof Error ? e.message : (e as { error?: unknown }).error;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
}

/** 409 FIELDS_SCHEMA_MISMATCH: the config changed while the popup was open. The host calls
 *  sf.reload(); the drafts stay, keyed by FieldId (useFieldsState). */
export function shouldReloadFields(e: unknown): boolean {
  return codeOf(e) === "FIELDS_SCHEMA_MISMATCH";
}
