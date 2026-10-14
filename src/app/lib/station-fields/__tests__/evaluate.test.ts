import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_FINISH_ON_REQUIRED,
  evaluateFields,
  failValueText,
  fieldHasValue,
  fieldsBlocking,
  fieldsGateMessage,
  isBlankFieldValue,
  isFieldFail,
  noteRequired,
  numberInRange,
  parseNumberText,
  pendingPhotos,
  requiredProgress,
  suggestionText,
  toFieldValue,
  toResultBlock,
} from "../evaluate";
import type { Drafts, FieldDraft } from "../evaluate";
import type {
  ChecklistField, ChoiceOption, ChoiceRowField, Field, FieldValue, FieldsSchemaRef, MultiChoiceField,
  NumberField, PassFailField, PhotoField, SectionField, TextField, Tone,
} from "../schema";
import {
  PASS_FAIL_WORD, SUGGEST_PREFIX, SUGGEST_PREFIX_DIALOG, SUGGEST_TAIL_WORKER_DECIDES,
  fieldsGateText, missLabel, statusA, statusB, statusC,
} from "../labels";

// ---- fixtures (artboard 14's "חשמל" fields) ----------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const POST = [opt("o_post0001", "עולה תקין", "pass"), opt("o_post0002", "עולה עם שגיאה", "warn"), opt("o_post0003", "לא עולה", "fail"), opt("o_post0004", "לא נבדק", "neutral")];
const FAN = [opt("o_fan00001", "מסתובב תקין", "pass"), opt("o_fan00002", "רעש חריג", "warn"), opt("o_fan00003", "לא מסתובב", "fail"), opt("o_fan00004", "לא נבדק", "neutral")];
const PARTS = [opt("o_prt00001", "קיים", "pass"), opt("o_prt00002", "חסר", "fail"), opt("o_prt00003", "פגום", "fail"), opt("o_prt00004", "הוחלף", "warn")];

const section: SectionField = { id: "f_sec00001", type: "section", label: "בטיחות חשמלית" };
const led: ChoiceRowField = { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: LED };
const post: ChoiceRowField = { id: "f_post0001", type: "choice_row", label: "הפעלה ו-POST", required: true, notes: "required_on_fail", options: POST };
const fan: ChoiceRowField = { id: "f_fan00001", type: "choice_row", label: "מאוורר ספק הכוח", required: false, notes: "optional", options: FAN };
const gnd: NumberField = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const iso: PassFailField = { id: "f_iso00001", type: "pass_fail", label: "בדיקת בידוד", required: true, notes: "required_on_fail" };
const ELEC: Field[] = [led, post, fan, section, gnd, iso];

/** FieldValues the way a popup builds them: draft → toFieldValue. */
function valuesOf(defs: readonly Field[], drafts: Drafts): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const def of defs) {
    const v = toFieldValue(def, drafts[def.id]);
    if (v) out[def.id] = v;
  }
  return out;
}
const evalDrafts = (defs: readonly Field[], drafts: Drafts) => evaluateFields(defs, valuesOf(defs, drafts));
const allPass: Drafts = {
  f_led00001: { opt: "o_led00001" }, f_post0001: { opt: "o_post0001" }, f_fan00001: { opt: "o_fan00001" },
  f_gnd00001: { num: "0.08" }, f_iso00001: { ok: "pass" },
};

// ---- suggestion and fails -----------------------------------------------------------------
test("a fail tone suggests 'fail' and lists ALL fails, in field order", () => {
  const ev = evalDrafts(ELEC, {
    ...allPass,
    f_led00001: { opt: "o_led00003", note: "לא נדלקת" },
    f_post0001: { opt: "o_post0003", note: "מצפצף" },
    f_gnd00001: { num: "0,2" },
  });
  assert.equal(ev.suggested, "fail");
  assert.deepEqual(ev.fails, [
    { field_id: "f_led00001", label: "נורית מתח", valueText: "לא דולקת" },
    { field_id: "f_post0001", label: "הפעלה ו-POST", valueText: "לא עולה" },
    { field_id: "f_gnd00001", label: "התנגדות הארקה", valueText: "0.2 Ω" },
  ]);
  assert.deepEqual(ev.firstFail, ev.fails[0]);
  assert.equal(
    suggestionText(SUGGEST_PREFIX, ev.fails),
    "מוצע: לא תקין — 'נורית מתח' = לא דולקת · 'הפעלה ו-POST' = לא עולה · 'התנגדות הארקה' = 0.2 Ω",
  );
  assert.equal(suggestionText(SUGGEST_PREFIX_DIALOG, ev.fails.slice(0, 1)), "מוצע לסמן כלא תקין — 'נורית מתח' = לא דולקת");
  assert.equal(SUGGEST_TAIL_WORKER_DECIDES, " · ההחלטה בידי העובד");
});

test("suggested: every D3 case", () => {
  // Nothing drives a verdict → null, however complete.
  assert.equal(evaluateFields([], {}).suggested, null);
  const text: TextField = { id: "f_txt00001", type: "text", label: "הערת קליטה", required: true, notes: "off" };
  assert.equal(evalDrafts([text, section], { f_txt00001: { text: "x" } }).suggested, null);
  // Every verdict-driving field filled without a fail → "pass" (warn and neutral are not fails).
  assert.equal(evalDrafts(ELEC, allPass).suggested, "pass");
  assert.equal(evalDrafts(ELEC, { ...allPass, f_led00001: { opt: "o_led00002" }, f_fan00001: { opt: "o_fan00004" } }).suggested, "pass");
  // One verdict-driving field empty — even an optional one → null.
  assert.equal(evalDrafts(ELEC, { ...allPass, f_fan00001: {} }).suggested, null);
  assert.equal(evalDrafts(ELEC, { ...allPass, f_iso00001: { ok: null } }).suggested, null);
  // A fail wins over anything empty.
  assert.equal(evalDrafts(ELEC, { f_iso00001: { ok: "fail" } }).suggested, "fail");
  // A number drives the verdict only with out_of_range_fail AND a range.
  const noRule: NumberField = { ...gnd, out_of_range_fail: false };
  const noRange: NumberField = { id: "f_tmp00001", type: "number", label: "טמפרטורה", required: false, notes: "off", unit: "°C", out_of_range_fail: true };
  const refOnly: NumberField = { ...noRange, id: "f_ref00001", ref: 20 };
  assert.equal(evalDrafts([led, noRule], { f_led00001: { opt: "o_led00001" } }).suggested, "pass");
  assert.equal(evalDrafts([led, noRange, refOnly], { f_led00001: { opt: "o_led00001" } }).suggested, "pass");
  assert.equal(evalDrafts([led, gnd], { f_led00001: { opt: "o_led00001" } }).suggested, null);
  assert.equal(evalDrafts([led, gnd], { f_led00001: { opt: "o_led00001" }, f_gnd00001: { num: "0.1" } }).suggested, "pass");
  assert.equal(evalDrafts([led, gnd], { f_led00001: { opt: "o_led00001" }, f_gnd00001: { num: "0.11" } }).suggested, "fail");
  assert.equal(evalDrafts([noRule], { f_gnd00001: { num: "5" } }).suggested, null);
  // multi_choice: nothing picked = no value; a pass pick → pass; any fail pick → fail.
  const parts: MultiChoiceField = { id: "f_prt00001", type: "multi_choice", label: "רכיבים", required: false, notes: "optional", options: PARTS };
  assert.equal(evalDrafts([parts], { f_prt00001: { opts: [] } }).suggested, null);
  assert.equal(evalDrafts([parts], { f_prt00001: { opts: ["o_prt00001", "o_prt00004"] } }).suggested, "pass");
  assert.equal(evalDrafts([parts], { f_prt00001: { opts: ["o_prt00001", "o_prt00003"] } }).suggested, "fail");
});

test("an unknown option, or a value of another type, is no value at all", () => {
  const ghost: FieldValue = { t: "choice_row", label: "נורית מתח", opt: "o_ghost001", opt_label: "רפאים", tone: "fail" };
  assert.equal(fieldHasValue(led, ghost), false);
  assert.equal(isFieldFail(led, ghost), false);
  const ev = evaluateFields([led], { f_led00001: ghost });
  assert.deepEqual([ev.suggested, ev.fails, ev.missingRequired], [null, [], ["f_led00001"]]);
  const wrongType: FieldValue = { t: "pass_fail", label: "נורית מתח", ok: "fail" };
  assert.deepEqual(evaluateFields([led], { f_led00001: wrongType }).missingRequired, ["f_led00001"]);
  assert.equal(evaluateFields([led], { f_led00001: wrongType }).suggested, null);
  // The definition's tone decides, not the tone a client copied into the value.
  const staleTone: FieldValue = { t: "choice_row", label: "נורית מתח", opt: "o_led00001", opt_label: "תקין", tone: "fail" };
  assert.equal(isFieldFail(led, staleTone), false);
});

// ---- notes ------------------------------------------------------------------------------------
test("required_on_fail demands a note only while the field fails", () => {
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00001" } }).missingNotes, []);
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00002" } }).missingNotes, []);
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00003" } }).missingNotes, ["f_led00001"]);
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00003", note: "   " } }).missingNotes, ["f_led00001"]);
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00003", note: "הנורית כבויה" } }).missingNotes, []);
  // The same rule for pass_fail and an out-of-range number.
  assert.deepEqual(evalDrafts([iso], { f_iso00001: { ok: "fail" } }).missingNotes, ["f_iso00001"]);
  assert.deepEqual(evalDrafts([{ ...gnd, notes: "required_on_fail" }], { f_gnd00001: { num: "0.2" } }).missingNotes, ["f_gnd00001"]);
  assert.deepEqual(evalDrafts([{ ...gnd, notes: "required_on_fail" }], { f_gnd00001: { num: "0.05" } }).missingNotes, []);
});

test("notes: 'required' always, 'optional' never, 'off' ignores the note", () => {
  assert.deepEqual(evalDrafts([{ ...led, notes: "required" }], { f_led00001: { opt: "o_led00001" } }).missingNotes, ["f_led00001"]);
  assert.deepEqual(evalDrafts([{ ...led, notes: "optional" }], { f_led00001: { opt: "o_led00003" } }).missingNotes, []);
  assert.deepEqual(evalDrafts([{ ...led, notes: "off" }], { f_led00001: { opt: "o_led00003" } }).missingNotes, []);
  assert.equal(noteRequired({ ...led, notes: "required" }, false), true);
  assert.equal(noteRequired(led, true), true);
  assert.equal(noteRequired(led, false), false);
  assert.equal(noteRequired({ ...led, notes: "off" }, true), false);
  assert.equal(noteRequired(section, true), false);
  // "off": a note in the draft never reaches the value, and a stored one is not even measured.
  assert.equal("note" in toFieldValue({ ...led, notes: "off" }, { opt: "o_led00001", note: "x" })!, false);
  const offNote: FieldValue = { t: "choice_row", label: "נורית מתח", opt: "o_led00001", opt_label: "תקין", tone: "pass", note: "x".repeat(5000) };
  assert.deepEqual(evaluateFields([{ ...led, notes: "off" }], { f_led00001: offNote }).noteTooLong, []);
});

test("note length: 1001 characters when note_max is absent, the field's own maximum otherwise", () => {
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00001", note: "x".repeat(1000) } }).noteTooLong, []);
  assert.deepEqual(evalDrafts([led], { f_led00001: { opt: "o_led00001", note: "x".repeat(1001) } }).noteTooLong, ["f_led00001"]);
  assert.deepEqual(evalDrafts([{ ...led, note_max: 500 }], { f_led00001: { note: "x".repeat(501) } }).noteTooLong, ["f_led00001"]);
  assert.deepEqual(evalDrafts([{ ...led, note_max: 2000 }], { f_led00001: { note: "x".repeat(2000) } }).noteTooLong, []);
  // UTF-16 code units, like the textarea's maxlength: an emoji is two.
  assert.deepEqual(evalDrafts([{ ...led, note_max: 500 }], { f_led00001: { note: "x".repeat(499) + "🙂" } }).noteTooLong, ["f_led00001"]);
});

// ---- numbers ----------------------------------------------------------------------------------
test("a number out of range fails only with out_of_range_fail", () => {
  const withRule = evalDrafts([gnd], { f_gnd00001: { num: "0.2" } });
  assert.deepEqual([withRule.suggested, withRule.fails.map((f) => f.valueText)], ["fail", ["0.2 Ω"]]);
  assert.deepEqual(toFieldValue(gnd, { num: "0.2" }),{ t: "number", label: "התנגדות הארקה", value: 0.2, unit: "Ω", in_range: false });
  const noRule: NumberField = { ...gnd, out_of_range_fail: false };
  const without = evalDrafts([noRule], { f_gnd00001: { num: "0.2" } });
  assert.deepEqual([without.suggested, without.fails], [null, []]);
  assert.equal(isFieldFail(noRule, toFieldValue(noRule, { num: "0.2" })), false);
  assert.deepEqual(toFieldValue(noRule, { num: "0.2" }), { t: "number", label: "התנגדות הארקה", value: 0.2, unit: "Ω", in_range: false });
});

test("numberInRange: inclusive bounds, ref ± tol%, null without a value or a range", () => {
  assert.equal(numberInRange(gnd, 0.1), true);
  assert.equal(numberInRange(gnd, 0.1000001), false);
  assert.equal(numberInRange(gnd, -3), true);   // max only
  const minOnly: NumberField = { ...gnd, max: undefined, min: 2 };
  assert.equal(numberInRange(minOnly, 2), true);
  assert.equal(numberInRange(minOnly, 1.99), false);
  const between: NumberField = { ...gnd, min: 1, max: 3 };
  assert.deepEqual([0.9, 1, 2, 3, 3.1].map((v) => numberInRange(between, v)), [false, true, true, true, false]);
  const tolerance: NumberField = { id: "f_v0000001", type: "number", label: "מתח", required: false, notes: "off", unit: "V", ref: 230, tol_pct: 10, out_of_range_fail: true };
  assert.deepEqual([206.9, 207, 230, 253, 253.1].map((v) => numberInRange(tolerance, v)), [false, true, true, true, false]);
  const small: NumberField = { ...tolerance, ref: 0.1, tol_pct: 10 };
  assert.deepEqual([0.089, 0.09, 0.11, 0.111].map((v) => numberInRange(small, v)), [false, true, true, false]);
  const negative: NumberField = { ...tolerance, ref: -5, tol_pct: 10 };
  assert.deepEqual([-5.6, -5.5, -4.5, -4.4].map((v) => numberInRange(negative, v)), [false, true, true, false]);
  // Bounds and tolerance together: both must hold.
  assert.equal(numberInRange({ ...tolerance, max: 240 }, 245), false);
  assert.equal(numberInRange(gnd, null), null);
  assert.equal(numberInRange(gnd, Number.NaN), null);
  assert.equal(numberInRange({ ...tolerance, tol_pct: undefined }, 230), null);   // a ref alone is not a range
  assert.equal(numberInRange({ ...gnd, max: undefined }, 5), null);
});

test("parseNumberText: trimmed, ',' read as '.', anything non-finite is no value", () => {
  assert.deepEqual(["0.2", " 0,2 ", "5", "-1.5", "1e3", "", "   ", "abc", "1.2.3", "Infinity", "-"].map(parseNumberText),
    [0.2, 0.2, 5, -1.5, 1000, null, null, null, null, null, null]);
  assert.equal(parseNumberText(undefined), null);
  assert.deepEqual(toFieldValue(gnd, { num: "abc" }), { t: "number", label: "התנגדות הארקה", value: null, unit: "Ω", in_range: null });
  assert.deepEqual(toFieldValue({ ...gnd, unit: undefined }, { num: "7" }), { t: "number", label: "התנגדות הארקה", value: 7, in_range: false });
});

// ---- value text -------------------------------------------------------------------------------
test("failValueText: option label, fail-tone labels joined ', ', '0.2 Ω', 'לא תקין'", () => {
  assert.equal(failValueText(led, toFieldValue(led, { opt: "o_led00003" })), "לא דולקת");
  const parts: MultiChoiceField = { id: "f_prt00001", type: "multi_choice", label: "רכיבים", required: false, notes: "optional", options: PARTS };
  const picked = toFieldValue(parts, { opts: ["o_prt00003", "o_prt00001", "o_prt00002"] });
  assert.equal(failValueText(parts, picked), "חסר, פגום");
  const ev = evaluateFields([parts], { f_prt00001: picked });
  assert.deepEqual(ev.fails, [{ field_id: "f_prt00001", label: "רכיבים", valueText: "חסר, פגום" }]);
  assert.equal(failValueText(gnd, toFieldValue(gnd, { num: "0.2" })), "0.2 Ω");
  assert.equal(failValueText({ ...gnd, unit: undefined }, toFieldValue({ ...gnd, unit: undefined }, { num: "0.2" })), "0.2");
  assert.equal(failValueText(iso, toFieldValue(iso, { ok: "fail" })), "לא תקין");
  assert.equal(PASS_FAIL_WORD.fail, "לא תקין");
  assert.equal(failValueText(section, undefined), "");
});

// ---- other field types -----------------------------------------------------------------------
test("checklist has a value only when every item is ticked; photo needs max(min, 1) finished shots, and an unfinished shot blocks", () => {
  const box: ChecklistField = { id: "f_chk00001", type: "checklist", label: "אביזרים", required: true, notes: "off", items: [{ id: "c_stand001", label: "מעמד" }, { id: "c_cable001", label: "כבל" }] };
  assert.deepEqual(toFieldValue(box, { checked: { c_stand001: true } }), {
    t: "checklist", label: "אביזרים", items: [{ id: "c_stand001", label: "מעמד", ok: true }, { id: "c_cable001", label: "כבל", ok: false }],
  });
  assert.deepEqual(evalDrafts([box], { f_chk00001: { checked: { c_stand001: true } } }).missingRequired, ["f_chk00001"]);
  assert.deepEqual(evalDrafts([box], { f_chk00001: { checked: { c_stand001: true, c_cable001: true } } }).missingRequired, []);
  // No items: nothing left to tick, whether or not a (blank) value was stored — lint keeps it from
  // being published (CHECKLIST_EMPTY).
  const noItems: ChecklistField = { ...box, items: [] };
  assert.equal(fieldHasValue(noItems, undefined), true);
  assert.equal(fieldHasValue(noItems, toFieldValue(noItems, undefined)), true);
  assert.deepEqual(evaluateFields([noItems], {}).missingRequired, []);

  const shot = (objectKey?: string, extra: object = {}) => ({ previewUrl: "blob:x", objectKey, ...extra });
  const photo: PhotoField = { id: "f_pho00001", type: "photo", label: "צילום חזית", required: false, notes: "off", photo_type: "front", min: 2 };
  const shots = [shot("items/1/a.jpg"), shot(undefined, { uploading: true }), shot("items/1/b.jpg", { failed: true }), shot("items/1/c.jpg")];
  const value = toFieldValue(photo, { photos: shots });
  // Only finished shots are saved...
  assert.deepEqual(value, { t: "photo", label: "צילום חזית", photo_type: "front", photos: ["items/1/a.jpg", "items/1/c.jpg"] });
  assert.equal(fieldHasValue(photo, value), true);
  // ...so a shot still uploading, or one that failed, holds finishing back (spec §4.8) — even with
  // the minimum met and the gate off: finishing would silently drop that photo.
  assert.deepEqual(pendingPhotos([photo], { f_pho00001: { photos: shots } }), ["f_pho00001"]);
  assert.deepEqual(pendingPhotos([photo], { f_pho00001: { photos: [shot("k1"), shot(undefined, { uploading: true })] } }), ["f_pho00001"]);
  assert.deepEqual(pendingPhotos([photo], { f_pho00001: { photos: [shot("k1"), shot("k2", { failed: true })] } }), ["f_pho00001"]);
  assert.deepEqual(pendingPhotos([photo], { f_pho00001: { photos: [shot("k1"), shot()] } }), ["f_pho00001"]);   // no key: lost too
  assert.deepEqual(pendingPhotos([photo, led], { f_pho00001: { photos: [shot("k1"), shot("k2")] } }), []);
  assert.deepEqual(pendingPhotos([photo], {}), []);
  const optional: PhotoField = { ...photo, min: 0 };
  const uploading = { f_pho00001: { photos: [shot(undefined, { uploading: true })] } };
  const ev = evalDrafts([optional], uploading);
  assert.deepEqual(ev.missingRequired, []);
  assert.equal(fieldsBlocking(ev, true, pendingPhotos([optional], uploading)), true);
  assert.equal(fieldsBlocking(ev, false, pendingPhotos([optional], uploading)), true);
  // A minimum binds even when the field is not required.
  assert.deepEqual(evalDrafts([photo], { f_pho00001: { photos: [shot("items/1/a.jpg")] } }).missingRequired, ["f_pho00001"]);
  assert.deepEqual(evalDrafts([{ ...photo, min: 0 }], {}).missingRequired, []);
  assert.deepEqual(evalDrafts([{ ...photo, min: 0, required: true }], {}).missingRequired, ["f_pho00001"]);
  assert.deepEqual(evalDrafts([{ ...photo, min: 0, required: true }], { f_pho00001: { photos: [shot("k")] } }).missingRequired, []);
});

test("text / textarea / scan have a value when not blank", () => {
  const text: TextField = { id: "f_txt00001", type: "text", label: "הערת קליטה", required: true, notes: "off" };
  assert.deepEqual(toFieldValue(text, { text: "  " }), { t: "text", label: "הערת קליטה", value: "  " });
  assert.deepEqual(evalDrafts([text], { f_txt00001: { text: "  " } }).missingRequired, ["f_txt00001"]);
  assert.deepEqual(evalDrafts([text], { f_txt00001: { text: "x" } }).missingRequired, []);
  assert.deepEqual(toFieldValue({ ...text, type: "scan" }, undefined), { t: "scan", label: "הערת קליטה", value: "" });
});

// ---- required and sections ---------------------------------------------------------------------
test("missingRequired lists required fields without a value; a section is never counted", () => {
  const ev = evalDrafts(ELEC, { f_led00001: { opt: "o_led00001" } });
  assert.deepEqual(ev.missingRequired, ["f_post0001", "f_gnd00001", "f_iso00001"]);
  const onlySection = evaluateFields([section], {});
  assert.deepEqual(onlySection, { suggested: null, fails: [], firstFail: null, missingRequired: [], missingNotes: [], noteTooLong: [] });
  assert.equal(toFieldValue(section, {}), undefined);
  assert.equal(fieldHasValue(section, undefined), false);
  assert.deepEqual(requiredProgress(ELEC, ev), { done: 1, total: 4 });
  assert.deepEqual(requiredProgress(ELEC, evalDrafts(ELEC, allPass)), { done: 4, total: 4 });
});

// ---- the saved block -------------------------------------------------------------------------
const schemaRef: FieldsSchemaRef = { route_id: 77, v: 5, step_uid: "s_elec0001", target: "item" };

test("toFieldValue copies labels, option label and tone from the definition; an unknown option is none", () => {
  assert.deepEqual(toFieldValue(led, { opt: "o_led00003", note: " פרט " }), {
    t: "choice_row", label: "נורית מתח", opt: "o_led00003", opt_label: "לא דולקת", tone: "fail", note: " פרט ",
  });
  assert.deepEqual(toFieldValue(led, { opt: "o_nothere1" }), { t: "choice_row", label: "נורית מתח", opt: null, opt_label: null, tone: null });
  assert.deepEqual(toFieldValue(led, undefined), { t: "choice_row", label: "נורית מתח", opt: null, opt_label: null, tone: null });
  assert.deepEqual(toFieldValue(led, { opt: "o_led00001", note: "  " }), { t: "choice_row", label: "נורית מתח", opt: "o_led00001", opt_label: "תקין", tone: "pass" });
  assert.deepEqual(toFieldValue(iso, { ok: "fail" }), { t: "pass_fail", label: "בדיקת בידוד", ok: "fail" });
});

test("toResultBlock: no sections, suggested from the fields, ok/note only when given, overridden only on disagreement", () => {
  const drafts: Drafts = { ...allPass, f_led00001: { opt: "o_led00003", note: "כבויה" }, f_sec00001: { text: "ignored" } as FieldDraft };
  const block = toResultBlock(ELEC, drafts, schemaRef, { ok: "pass", note: "" });
  assert.deepEqual(block.schema, schemaRef);
  assert.notEqual(block.schema, schemaRef);
  assert.deepEqual(Object.keys(block.fields), ["f_led00001", "f_post0001", "f_fan00001", "f_gnd00001", "f_iso00001"]);
  assert.deepEqual(block.fields.f_led00001, { t: "choice_row", label: "נורית מתח", opt: "o_led00003", opt_label: "לא דולקת", tone: "fail", note: "כבויה" });
  assert.deepEqual(block.verdict, { ok: "pass", note: "", suggested: "fail", overridden: true });
  assert.deepEqual(Object.keys(block.verdict), ["ok", "note", "suggested", "overridden"]);

  assert.deepEqual(toResultBlock(ELEC, drafts, schemaRef, { ok: "fail" }).verdict, { ok: "fail", suggested: "fail" });
  assert.deepEqual(toResultBlock(ELEC, drafts, schemaRef, {}).verdict, { suggested: "fail" });
  assert.deepEqual(toResultBlock(ELEC, drafts, schemaRef).verdict, { suggested: "fail" });
  assert.deepEqual(toResultBlock(ELEC, allPass, schemaRef, { ok: "fail" }).verdict, { ok: "fail", suggested: "pass", overridden: true });
  assert.deepEqual(toResultBlock(ELEC, {}, schemaRef, { ok: "pass" }).verdict, { ok: "pass", suggested: null });
});

test("toResultBlock stores only the fields the worker filled — publish-preview counts 'מולא ב-N בדיקות' by key", () => {
  // An untouched field leaves no key: details -> 'fields' ? id must not count it (spec §3.4.2).
  assert.deepEqual(toResultBlock([fan], {}, schemaRef).fields, {});
  assert.deepEqual(toResultBlock(ELEC, { f_fan00001: { opt: "o_nothere1", note: "   " }, f_gnd00001: { num: "abc" }, f_iso00001: { ok: null } }, schemaRef).fields, {});
  // A note alone is data.
  assert.deepEqual(toResultBlock([fan], { f_fan00001: { note: "לא נבדק — אין גישה" } }, schemaRef).fields, {
    f_fan00001: { t: "choice_row", label: "מאוורר ספק הכוח", opt: null, opt_label: null, tone: null, note: "לא נבדק — אין גישה" },
  });
  // So is a partial value: one ticked item, one saved photo, one picked option.
  const box: ChecklistField = { id: "f_chk00001", type: "checklist", label: "אביזרים", required: true, notes: "off", items: [{ id: "c_stand001", label: "מעמד" }, { id: "c_cable001", label: "כבל" }] };
  const photo: PhotoField = { id: "f_pho00001", type: "photo", label: "צילום חזית", required: false, notes: "off", photo_type: "front", min: 2 };
  const parts: MultiChoiceField = { id: "f_prt00001", type: "multi_choice", label: "רכיבים", required: false, notes: "optional", options: PARTS };
  const text: TextField = { id: "f_txt00001", type: "text", label: "הערת קליטה", required: false, notes: "off" };
  const partial = toResultBlock([box, photo, parts, text], {
    f_chk00001: { checked: { c_cable001: true } },
    f_pho00001: { photos: [{ previewUrl: "blob:x", objectKey: "items/1/a.jpg" }] },
    f_prt00001: { opts: ["o_prt00004"] },
    f_txt00001: { text: "  " },
  }, schemaRef);
  assert.deepEqual(Object.keys(partial.fields), ["f_chk00001", "f_pho00001", "f_prt00001"]);
  assert.deepEqual(toResultBlock([box, photo], { f_chk00001: { checked: { c_cable001: false } }, f_pho00001: { photos: [] } }, schemaRef).fields, {});
});

test("isBlankFieldValue: nothing entered and no note, per type", () => {
  const snap = { label: "שדה" };
  const blank: FieldValue[] = [
    { ...snap, t: "choice_row", opt: null, opt_label: null, tone: null },
    { ...snap, t: "multi_choice", opts: [] },
    { ...snap, t: "pass_fail", ok: null },
    { ...snap, t: "number", value: null, in_range: null },
    { ...snap, t: "text", value: "" },
    { ...snap, t: "textarea", value: " \n " },
    { ...snap, t: "scan", value: "" },
    { ...snap, t: "checklist", items: [{ id: "c_stand001", label: "מעמד", ok: false }] },
    { ...snap, t: "checklist", items: [] },
    { ...snap, t: "photo", photo_type: "front", photos: [] },
    { ...snap, t: "pass_fail", ok: null, note: "  " },
  ];
  for (const v of blank) assert.equal(isBlankFieldValue(v), true, JSON.stringify(v));
  const filled: FieldValue[] = [
    { ...snap, t: "choice_row", opt: "o_led00001", opt_label: "תקין", tone: "pass" },
    { ...snap, t: "multi_choice", opts: [{ id: "o_prt00001", label: "קיים", tone: "pass" }] },
    { ...snap, t: "pass_fail", ok: "fail" },
    { ...snap, t: "number", value: 0, in_range: true },
    { ...snap, t: "text", value: "x" },
    { ...snap, t: "checklist", items: [{ id: "c_stand001", label: "מעמד", ok: true }, { id: "c_cable001", label: "כבל", ok: false }] },
    { ...snap, t: "photo", photo_type: "front", photos: ["items/1/a.jpg"] },
    { ...snap, t: "number", value: null, in_range: null, note: "המכשיר לא נדלק" },
  ];
  for (const v of filled) assert.equal(isBlankFieldValue(v), false, JSON.stringify(v));
});

test("the popup (every value) and the server (filled values only) evaluate alike", () => {
  const noItems: ChecklistField = { id: "f_chk00002", type: "checklist", label: "ריק", required: true, notes: "required", items: [] };
  const box: ChecklistField = { id: "f_chk00001", type: "checklist", label: "אביזרים", required: true, notes: "required_on_fail", items: [{ id: "c_stand001", label: "מעמד" }] };
  const photo: PhotoField = { id: "f_pho00001", type: "photo", label: "צילום חזית", required: false, notes: "required", photo_type: "front", min: 1 };
  const parts: MultiChoiceField = { id: "f_prt00001", type: "multi_choice", label: "רכיבים", required: true, notes: "required_on_fail", options: PARTS };
  const text: TextField = { id: "f_txt00001", type: "text", label: "הערת קליטה", required: true, notes: "optional" };
  const defs: Field[] = [...ELEC, noItems, box, photo, parts, text, { ...text, id: "f_scn00001", type: "scan" }];
  const cases: Drafts[] = [
    {},
    allPass,
    { f_led00001: { opt: "o_led00003" }, f_gnd00001: { num: "x" }, f_txt00001: { text: " " } },
    { f_led00001: { note: "רק הערה" }, f_chk00001: { checked: {} }, f_prt00001: { opts: ["o_prt00002"] } },
    { ...allPass, f_chk00001: { checked: { c_stand001: true } }, f_pho00001: { photos: [{ previewUrl: "b", objectKey: "k" }] }, f_txt00001: { text: "x" } },
  ];
  for (const drafts of cases) {
    assert.deepEqual(evaluateFields(defs, toResultBlock(defs, drafts, schemaRef).fields), evalDrafts(defs, drafts), JSON.stringify(drafts));
  }
});

// ---- gate, statuses ----------------------------------------------------------------------------
test("the finish gate: constant, blocking rule and the artboard 14 messages", () => {
  assert.equal(GATE_FINISH_ON_REQUIRED, true);
  const none = { missingRequired: [], missingNotes: [], noteTooLong: [] };
  assert.equal(fieldsBlocking(none, true, []), false);
  assert.equal(fieldsBlocking({ ...none, missingRequired: ["f_a"] }, true, []), true);
  assert.equal(fieldsBlocking({ ...none, missingNotes: ["f_a"] }, true, []), true);
  assert.equal(fieldsBlocking({ ...none, missingRequired: ["f_a"] }, false, []), false);
  // Blocking whatever the gate says: a note over its maximum, a photo not saved yet.
  assert.equal(fieldsBlocking({ ...none, noteTooLong: ["f_a"] }, false, []), true);
  assert.equal(fieldsBlocking(none, false, ["f_a"]), true);
  assert.equal(fieldsBlocking(none, true, ["f_a"]), true);

  assert.equal(fieldsGateMessage({ missingRequired: [], missingNotes: [] }), null);
  assert.equal(fieldsGateMessage({ missingRequired: ["f_a"], missingNotes: [] }), "נותר שדה חובה אחד בבדיקות העמדה — יש למלא לפני סיום בדיקה");
  assert.equal(fieldsGateMessage({ missingRequired: [], missingNotes: ["f_a"] }), "חסרה הערה לחריגה בבדיקות העמדה — יש לפרט לפני סיום בדיקה");
  assert.equal(fieldsGateMessage({ missingRequired: ["f_a", "f_b"], missingNotes: ["f_c"] }), "נותרו 3 שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה");
  // The artboard counts two missing notes as "שדות חובה" too.
  assert.equal(fieldsGateText(0, 2), "נותרו 2 שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה");
  const ev = evalDrafts(ELEC, { ...allPass, f_iso00001: {}, f_led00001: { opt: "o_led00003" } });
  assert.equal(fieldsGateMessage(ev), "נותרו 2 שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה");
});

test("a field missing both its value and its note counts once, as every artboard counts it", () => {
  const both: ChoiceRowField = { ...led, notes: "required" };   // required, and a note always
  const empty = evalDrafts([both], {});
  assert.deepEqual([empty.missingRequired, empty.missingNotes], [["f_led00001"], []]);
  assert.equal(fieldsGateMessage(empty), "נותר שדה חובה אחד בבדיקות העמדה — יש למלא לפני סיום בדיקה");
  assert.deepEqual(statusA(empty.missingRequired.length, empty.missingNotes.length), { text: "נותר שדה חובה אחד", tone: "muted" });
  assert.equal(missLabel(empty.missingRequired.length, empty.missingNotes.length), "נותר שדה חובה אחד");
  assert.deepEqual(requiredProgress([both], empty), { done: 0, total: 1 });
  // Once the value is in, the blank note is what is left.
  const noNote = evalDrafts([both], { f_led00001: { opt: "o_led00001" } });
  assert.deepEqual([noNote.missingRequired, noNote.missingNotes], [[], ["f_led00001"]]);
  assert.equal(fieldsGateMessage(noNote), "חסרה הערה לחריגה בבדיקות העמדה — יש לפרט לפני סיום בדיקה");
  assert.equal(fieldsGateMessage(evalDrafts([both], { f_led00001: { opt: "o_led00001", note: "נבדק" } })), null);
  // A note-only demand on a field that is not required still counts — once.
  const optionalField = evalDrafts([{ ...both, required: false }], {});
  assert.deepEqual([optionalField.missingRequired, optionalField.missingNotes], [[], ["f_led00001"]]);
  // Two such fields plus a required one left empty: three fields, not five.
  const many = evalDrafts([both, { ...both, id: "f_led00002" }, post], {});
  assert.equal(fieldsGateMessage(many), "נותרו 3 שדות חובה בבדיקות העמדה — יש למלא לפני סיום בדיקה");
  // The gate still holds a missing field back whichever list it sits in.
  assert.equal(fieldsBlocking(empty, true, []), true);
  assert.equal(fieldsBlocking(noNote, true, []), true);
});

test("status lines א / ב / ג and missLabel, word for word", () => {
  assert.deepEqual(statusA(0, 0), { text: "כל שדות החובה מולאו", tone: "success" });
  assert.deepEqual(statusA(0, 1), { text: "חסרה הערה לחריגה", tone: "muted" });
  assert.deepEqual(statusA(1, 0), { text: "נותר שדה חובה אחד", tone: "muted" });
  assert.deepEqual(statusA(2, 1), { text: "נותרו 3 שדות חובה", tone: "muted" });
  assert.deepEqual(statusA(0, 2), { text: "נותרו 2 שדות חובה", tone: "muted" });

  assert.deepEqual(statusB(4, 4, 0), { text: "כל שדות החובה מולאו", tone: "success" });
  assert.deepEqual(statusB(3, 4, 0), { text: "3 / 4 שדות חובה", tone: "muted" });
  assert.deepEqual(statusB(3, 4, 1), { text: "3 / 4 שדות חובה", tone: "muted" });
  assert.deepEqual(statusB(4, 4, 1), { text: "חסרה הערה לחריגה", tone: "danger" });

  assert.deepEqual(statusC(5, 5, 0), { text: "כל שדות החובה מולאו", tone: "success" });
  assert.deepEqual(statusC(4, 5, 0), { text: "חובה: 4 מתוך 5", tone: "muted" });
  assert.deepEqual(statusC(5, 5, 1), { text: "חובה: 5 מתוך 5", tone: "muted" });

  assert.equal(missLabel(0, 1), "חסרה הערה לחריגה");
  assert.equal(missLabel(1, 0), "נותר שדה חובה אחד");
  assert.equal(missLabel(0, 2), "נותרו 2 שדות חובה");
  assert.equal(missLabel(2, 3), "נותרו 5 שדות חובה");
});
