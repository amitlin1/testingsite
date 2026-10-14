import { test } from "node:test";
import assert from "node:assert/strict";
import { UNDRAWN_TEXT, fieldsGateText } from "@/app/lib/station-fields/labels";
import { FIELDS_ERROR_CODES, fieldsErrorText, isFieldsError, isFieldsErrorCode, shouldReloadFields } from "../errors";

/** What page.tsx's handleSubmitTestResult throws for an error answer: its message, and its code. */
const thrown = (message: string, code?: string) => Object.assign(new Error(message), { code });
/** VerdictStation / PhotoStation's own save error. */
const FALLBACK = "שגיאה בשמירת הבדיקה";
/** The server's messages (submit.ts). */
const GATE = fieldsGateText(1, 0) ?? "";
const MISMATCH = UNDRAWN_TEXT.schemaMismatch;
const TOO_LONG = UNDRAWN_TEXT.noteTooLong;

test("the codes are D5's, all five", () => {
  assert.deepEqual(FIELDS_ERROR_CODES, [
    "FIELDS_SCHEMA_MISMATCH", "FIELDS_INVALID", "NOTE_TOO_LONG", "FIELDS_INCOMPLETE", "DETAILS_TOO_LARGE",
  ]);
  for (const code of FIELDS_ERROR_CODES) assert.equal(isFieldsErrorCode(code), true);
  for (const other of ["", "fields_incomplete", "toString", "constructor", "__proto__", 422, null, undefined]) {
    assert.equal(isFieldsErrorCode(other), false, String(other));
  }
});

test("isFieldsError: an Error carrying one of the codes", () => {
  for (const code of FIELDS_ERROR_CODES) assert.equal(isFieldsError(thrown("x", code)), true, code);
  assert.equal(isFieldsError(thrown("Failed to save test result")), false);
  assert.equal(isFieldsError(thrown("x", "SOMETHING_ELSE")), false);
  assert.equal(isFieldsError({ error: GATE, code: "FIELDS_INCOMPLETE" }), false);   // a body is not an Error
  assert.equal(isFieldsError(null), false);
  assert.equal(isFieldsError("FIELDS_INCOMPLETE"), false);
});

test("fieldsErrorText: the server's text when it is written for the worker, the popup's own otherwise", () => {
  assert.equal(fieldsErrorText(thrown(GATE, "FIELDS_INCOMPLETE"), FALLBACK), GATE);
  assert.equal(fieldsErrorText(thrown(MISMATCH, "FIELDS_SCHEMA_MISMATCH"), FALLBACK), MISMATCH);
  assert.equal(fieldsErrorText(thrown(TOO_LONG, "NOTE_TOO_LONG"), FALLBACK), TOO_LONG);
  // English, technical: never shown to the worker
  assert.equal(fieldsErrorText(thrown("Invalid station fields: f_x", "FIELDS_INVALID"), FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText(thrown("Details too large", "DETAILS_TOO_LARGE"), FALLBACK), FALLBACK);
  // anything else, or no text
  assert.equal(fieldsErrorText(thrown("Failed to save test result"), FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText(thrown("  ", "FIELDS_INCOMPLETE"), FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText(new TypeError("fetch failed"), FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText(undefined, FALLBACK), FALLBACK);
});

test("fieldsErrorText reads a response body too (the package wizards post themselves)", () => {
  assert.equal(fieldsErrorText({ error: GATE, code: "FIELDS_INCOMPLETE", missing: [] }, FALLBACK), GATE);
  assert.equal(fieldsErrorText({ error: "Invalid station fields: x", code: "FIELDS_INVALID" }, FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText({ code: "FIELDS_INCOMPLETE" }, FALLBACK), FALLBACK);
  assert.equal(fieldsErrorText({ error: "Item not found" }, FALLBACK), FALLBACK);
});

test("shouldReloadFields: 409 FIELDS_SCHEMA_MISMATCH only, from an Error or a body", () => {
  assert.equal(shouldReloadFields(thrown(MISMATCH, "FIELDS_SCHEMA_MISMATCH")), true);
  assert.equal(shouldReloadFields({ error: MISMATCH, code: "FIELDS_SCHEMA_MISMATCH" }), true);
  for (const code of FIELDS_ERROR_CODES.filter((c) => c !== "FIELDS_SCHEMA_MISMATCH")) {
    assert.equal(shouldReloadFields(thrown("x", code)), false, code);
  }
  assert.equal(shouldReloadFields(new Error("x")), false);
  assert.equal(shouldReloadFields(null), false);
});
