import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api/client";
import { FIELDS_UNDRAWN_TEXT, fieldsGateText } from "@/app/lib/station-fields/labels";
import { failureText } from "@/app/components/failureText";
import { shouldReloadFields } from "../errors";

/** What postResult throws for an error answer: the body as the server sent it. */
const refused = (status: number, body: Record<string, unknown>) =>
  new ApiError(status, typeof body.error === "string" && body.error ? body.error : "הפעולה נכשלה", body);
/** VerdictStation / PhotoStation's own save error. */
const FALLBACK = "שגיאה בשמירת הבדיקה";
/** The server's messages (submit.ts). */
const GATE = fieldsGateText(1, 0) ?? "";
const MISMATCH = FIELDS_UNDRAWN_TEXT.schemaMismatch;
const TOO_LONG = FIELDS_UNDRAWN_TEXT.noteTooLong;

test("a station-field refusal: the server's text when it is written for the worker, the popup's own otherwise", () => {
  assert.equal(failureText(refused(422, { error: GATE, code: "FIELDS_INCOMPLETE", missing: [] }), FALLBACK), GATE);
  assert.equal(failureText(refused(409, { error: MISMATCH, code: "FIELDS_SCHEMA_MISMATCH" }), FALLBACK), MISMATCH);
  assert.equal(failureText(refused(400, { error: TOO_LONG, code: "NOTE_TOO_LONG" }), FALLBACK), TOO_LONG);
  // English, technical: never shown to the worker
  assert.equal(failureText(refused(400, { error: "Invalid station fields: f_x", code: "FIELDS_INVALID" }), FALLBACK), FALLBACK);
  assert.equal(failureText(refused(413, { error: "Details too large", code: "DETAILS_TOO_LARGE" }), FALLBACK), FALLBACK);
  assert.equal(failureText(refused(404, { error: "Item route not found" }), FALLBACK), FALLBACK);
  // no text, or not JSON (the call's own message is not the server's)
  assert.equal(failureText(refused(422, { error: "  ", code: "FIELDS_INCOMPLETE" }), FALLBACK), FALLBACK);
  assert.equal(failureText(refused(422, { code: "FIELDS_INCOMPLETE" }), FALLBACK), FALLBACK);
  assert.equal(failureText(refused(502, {}), FALLBACK), FALLBACK);
  // never reached the server
  assert.equal(failureText(new TypeError("Failed to fetch"), FALLBACK), FALLBACK);
  assert.equal(failureText(new TypeError("Failed to fetch"), FALLBACK, "שגיאה בתקשורת"), "שגיאה בתקשורת");
  assert.equal(failureText(undefined, FALLBACK), FALLBACK);
  // our own code's words on the way
  assert.equal(failureText(new Error("שמירת הפריט 01 נכשלה (500)"), FALLBACK), "שמירת הפריט 01 נכשלה (500)");
});

test("shouldReloadFields: 409 FIELDS_SCHEMA_MISMATCH only", () => {
  assert.equal(shouldReloadFields(refused(409, { error: MISMATCH, code: "FIELDS_SCHEMA_MISMATCH" })), true);
  for (const code of ["FIELDS_INVALID", "NOTE_TOO_LONG", "FIELDS_INCOMPLETE", "DETAILS_TOO_LARGE"]) {
    assert.equal(shouldReloadFields(refused(400, { error: "x", code })), false, code);
  }
  assert.equal(shouldReloadFields(new Error("x")), false);
  assert.equal(shouldReloadFields(null), false);
});
