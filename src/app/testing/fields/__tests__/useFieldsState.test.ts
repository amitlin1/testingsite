import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFields, toResultBlock } from "@/app/lib/station-fields/evaluate";
import type {
  ChoiceOption, ChoiceRowField, Field, FieldsSchemaRef, NumberField, PassFailField, PhotoField, SectionField, Tone,
} from "@/app/lib/station-fields/schema";
import {
  buildFieldsBlock, draftValues, evaluateDrafts, inputFieldCount, mergeDrafts, patchDraft,
  type Drafts,
} from "../useFieldsState";

// ---- fixtures (artboard 14's fields) ----------------------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const FAN = [opt("o_fan00001", "מסתובב תקין", "pass"), opt("o_fan00002", "רעש חריג", "warn"), opt("o_fan00003", "לא מסתובב", "fail"), opt("o_fan00004", "לא נבדק", "neutral")];

const led: ChoiceRowField = { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: LED };
const fan: ChoiceRowField = { id: "f_fan00001", type: "choice_row", label: "מאוורר ספק הכוח", required: false, notes: "optional", options: FAN };
const section: SectionField = { id: "f_sec00001", type: "section", label: "בטיחות חשמלית" };
const gnd: NumberField = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const iso: PassFailField = { id: "f_iso00001", type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail" };
const shot: PhotoField = { id: "f_pht00001", type: "photo", label: "צילום", required: false, notes: "off", photo_type: "product", min: 0 };
const DEFS: Field[] = [led, fan, section, gnd, iso];

const schema: FieldsSchemaRef = { route_id: 77, v: 5, step_uid: "s_abcd1234", target: "item" };
const allPass: Drafts = {
  f_led00001: { opt: "o_led00001" }, f_fan00001: { opt: "o_fan00001" }, f_gnd00001: { num: "0.08" }, f_iso00001: { ok: "pass" },
};

test("defsCount leaves section headers out", () => {
  assert.equal(inputFieldCount(DEFS), 4);
  assert.equal(inputFieldCount([section]), 0);
  assert.equal(inputFieldCount([]), 0);
});

test("evaluateDrafts is evaluateFields over every field's draft value", () => {
  const drafts: Drafts = { ...allPass, f_led00001: { opt: "o_led00003" }, f_gnd00001: { num: "0,2" } };
  const { ev } = evaluateDrafts(DEFS, drafts);
  assert.deepEqual(ev, evaluateFields(DEFS, draftValues(DEFS, drafts)));
  assert.equal(ev.suggested, "fail");
  assert.deepEqual(ev.fails.map((f) => [f.label, f.valueText]), [["נורית מתח", "לא דולקת"], ["התנגדות הארקה", "0.2 Ω"]]);
  // a failing LED with notes "required_on_fail" waits for its note
  assert.deepEqual(ev.missingNotes, ["f_led00001"]);
  // a blank value per input field, none for the section
  assert.deepEqual(Object.keys(draftValues(DEFS, {})), ["f_led00001", "f_fan00001", "f_gnd00001", "f_iso00001"]);
});

test("blocking(gate): the gate waits for required fields and notes; a long note blocks regardless", () => {
  const empty = evaluateDrafts(DEFS, {});
  assert.deepEqual(empty.ev.missingRequired, ["f_led00001", "f_gnd00001", "f_iso00001"]);
  assert.equal(empty.blocking(true), true);
  assert.equal(empty.blocking(false), false);

  const ready = evaluateDrafts(DEFS, allPass);
  assert.equal(ready.ev.suggested, "pass");
  assert.equal(ready.blocking(true), false);

  const noteMissing = evaluateDrafts(DEFS, { ...allPass, f_iso00001: { ok: "fail" } });
  assert.deepEqual(noteMissing.ev.missingNotes, ["f_iso00001"]);
  assert.equal(noteMissing.blocking(true), true);
  assert.equal(noteMissing.blocking(false), false);

  const tooLong = evaluateDrafts(DEFS, { ...allPass, f_fan00001: { opt: "o_fan00001", note: "א".repeat(1001) } });
  assert.deepEqual(tooLong.ev.noteTooLong, ["f_fan00001"]);
  assert.equal(tooLong.blocking(false), true);
});

test("a photo still uploading (or failed) blocks, gate or not", () => {
  const defs = [...DEFS, shot];
  const uploading = evaluateDrafts(defs, { ...allPass, f_pht00001: { photos: [{ previewUrl: "blob:1", uploading: true }] } });
  assert.deepEqual(uploading.photosPending, ["f_pht00001"]);
  assert.equal(uploading.blocking(false), true);
  const saved = evaluateDrafts(defs, { ...allPass, f_pht00001: { photos: [{ previewUrl: "blob:1", objectKey: "items/1/a.jpg" }] } });
  assert.deepEqual(saved.photosPending, []);
  assert.equal(saved.blocking(true), false);
});

test("drafts outlive a reload: kept by FieldId, read only through the new definitions", () => {
  const drafts: Drafts = { ...allPass, f_led00001: { opt: "o_led00003", note: "לא נדלקת" } };
  // v2: the fan field is gone and the LED's fail option was removed.
  const ledV2: ChoiceRowField = { ...led, options: LED.filter((o) => o.id !== "o_led00003") };
  const v2: Field[] = [ledV2, section, gnd, iso];
  const { ev } = evaluateDrafts(v2, drafts);
  assert.deepEqual(ev.missingRequired, ["f_led00001"]);   // an option that no longer exists reads as none
  assert.deepEqual(ev.fails, []);
  const block = buildFieldsBlock(v2, drafts, schema, { ok: "pass" });
  assert.deepEqual(Object.keys(block.fields), ["f_led00001", "f_gnd00001", "f_iso00001"]);   // the LED keeps its note
  assert.equal("f_fan00001" in block.fields, false);
});

test("patchDraft / mergeDrafts merge into one field's draft without touching the input", () => {
  const before: Drafts = { f_led00001: { opt: "o_led00001", note: "x" } };
  const after = patchDraft(before, "f_led00001", { opt: "o_led00003" });
  assert.deepEqual(after, { f_led00001: { opt: "o_led00003", note: "x" } });
  assert.deepEqual(before, { f_led00001: { opt: "o_led00001", note: "x" } });
  assert.deepEqual(patchDraft({}, "f_gnd00001", { num: "1" }), { f_gnd00001: { num: "1" } });

  const many = mergeDrafts(before, { f_led00001: { note: "y" }, f_iso00001: { ok: "pass" } });
  assert.deepEqual(many, { f_led00001: { opt: "o_led00001", note: "y" }, f_iso00001: { ok: "pass" } });
  assert.deepEqual(before, { f_led00001: { opt: "o_led00001", note: "x" } });
});

test("buildFieldsBlock reads the popup's '' as no decision, and is toResultBlock otherwise", () => {
  const drafts: Drafts = { ...allPass, f_led00001: { opt: "o_led00003", note: "לא נדלקת" } };
  const undecided = buildFieldsBlock(DEFS, drafts, schema, { ok: "", note: "" });
  assert.deepEqual(undecided.verdict, { note: "", suggested: "fail" });
  assert.deepEqual(buildFieldsBlock(DEFS, drafts, schema, { ok: null }).verdict, { suggested: "fail" });

  const overridden = buildFieldsBlock(DEFS, drafts, schema, { ok: "pass" });
  assert.deepEqual(overridden.verdict, { ok: "pass", suggested: "fail", overridden: true });
  assert.deepEqual(overridden, toResultBlock(DEFS, drafts, schema, { ok: "pass" }));

  const agreed = buildFieldsBlock(DEFS, drafts, { ...schema, target: "box" }, { ok: "fail" });
  assert.deepEqual(agreed.verdict, { ok: "fail", suggested: "fail" });
  assert.equal(agreed.schema.target, "box");
  assert.deepEqual(buildFieldsBlock(DEFS, {}, schema).verdict, { suggested: null });
});
