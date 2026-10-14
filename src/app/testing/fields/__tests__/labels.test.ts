import { test } from "node:test";
import assert from "node:assert/strict";
import type { NumberField } from "@/app/lib/station-fields/schema";
import { RANGE_WORD, WORKER_COPY_PENDING, choiceCountText, numberRangeForm, numberRangeLine } from "../labels";

// Artboard 14's number field: required, "עד 0.1 Ω", out of range counts as a fail.
const gnd: NumberField = {
  id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional",
  unit: "Ω", max: 0.1, out_of_range_fail: true,
};
const num = (over: Partial<NumberField>): NumberField => ({ ...gnd, min: undefined, max: undefined, ref: undefined, tol_pct: undefined, ...over });

test("the list footer's count (artboards 12/14/17 `countLabel`), and one option — COPY-PENDING", () => {
  assert.equal(choiceCountText(4, 4, false), "4 אפשרויות");
  assert.equal(choiceCountText(2, 4, true), "2 מתוך 4");
  assert.equal(choiceCountText(0, 4, true), "0 מתוך 4");
  assert.equal(choiceCountText(1, 1, false), WORKER_COPY_PENDING.optionCountOne);
  assert.equal(choiceCountText(1, 1, true), "1 מתוך 1");
});

test("the words are the artboards' (14 and 6 `rangeWord`, without their ' · עד')", () => {
  assert.deepEqual(RANGE_WORD, {
    idle: "טווח מותר", required: "יש להזין ערך", nan: "יש להזין מספר", in: "בטווח", out: "מחוץ לטווח",
  });
});

test("artboard 14: each state of a max-only field, word for word, colour and icon", () => {
  // The artboard writes rangeWord ('טווח מותר · עד') + ' ' + the LTR '0.1 Ω'.
  const idle = numberRangeLine(gnd, "", false);
  assert.equal(idle.text, "טווח מותר · עד 0.1 Ω");
  assert.deepEqual(idle.segments, [{ text: "טווח מותר · " }, { text: "עד " }, { text: "0.1 Ω", ltr: true }]);
  assert.deepEqual([idle.state, idle.tone, idle.icon, idle.invalid, idle.visible], ["idle", "muted", null, false, true]);

  const required = numberRangeLine(gnd, "", true);
  assert.equal(required.text, "יש להזין ערך · עד 0.1 Ω");
  assert.deepEqual([required.state, required.tone, required.icon, required.invalid], ["required", "danger", "alert", true]);

  const nan = numberRangeLine(gnd, "abc", false);
  assert.equal(nan.text, "יש להזין מספר · עד 0.1 Ω");
  assert.deepEqual([nan.state, nan.tone, nan.icon, nan.invalid], ["nan", "danger", "alert", true]);

  const inside = numberRangeLine(gnd, "0.08", false);
  assert.equal(inside.text, "בטווח · עד 0.1 Ω");
  assert.deepEqual([inside.state, inside.tone, inside.icon, inside.invalid], ["in", "success", "ok", false]);

  const outside = numberRangeLine(gnd, "0.2", false);
  assert.equal(outside.text, "מחוץ לטווח · עד 0.1 Ω");
  assert.deepEqual([outside.state, outside.tone, outside.icon, outside.invalid], ["out", "danger", "alert", true]);
});

test("the number reads like the evaluator reads it: ',' as '.', trimmed, bounds inclusive", () => {
  assert.equal(numberRangeLine(gnd, "0,08", false).state, "in");
  assert.equal(numberRangeLine(gnd, " 0.1 ", false).state, "in");
  assert.equal(numberRangeLine(gnd, "0.1000001", false).state, "out");
  assert.equal(numberRangeLine(gnd, "1,2,3", false).state, "nan");
  assert.equal(numberRangeLine(gnd, "-", false).state, "nan");
  assert.equal(numberRangeLine(gnd, "   ", false).state, "idle");
});

test("'יש להזין ערך' only for a required field left empty after a save attempt", () => {
  assert.equal(numberRangeLine(gnd, "", false).state, "idle");
  assert.equal(numberRangeLine(num({ max: 0.1, required: false }), "", true).state, "idle");
  assert.equal(numberRangeLine(gnd, "abc", true).state, "nan");
  assert.equal(numberRangeLine(gnd, "0.2", true).state, "out");
});

test("out of range is red whether or not it counts as a fail", () => {
  const line = numberRangeLine(num({ max: 0.1, out_of_range_fail: false }), "0.2", false);
  assert.deepEqual([line.state, line.tone, line.invalid], ["out", "danger", true]);
});

test("artboard 3's range forms: min only, min–max, no unit", () => {
  const minOnly = num({ min: 5, unit: "V" });
  assert.equal(numberRangeLine(minOnly, "", false).text, "טווח מותר · מעל 5 V");
  assert.equal(numberRangeLine(minOnly, "4", false).text, "מחוץ לטווח · מעל 5 V");
  assert.equal(numberRangeLine(minOnly, "5", false).state, "in");

  const both = num({ min: 0, max: 0.1 });
  assert.deepEqual(numberRangeForm(both), [{ text: "0–0.1 Ω", ltr: true }]);
  assert.equal(numberRangeLine(both, "0.05", false).text, "בטווח · 0–0.1 Ω");

  assert.equal(numberRangeLine(num({ max: 3, unit: undefined }), "", false).text, "טווח מותר · עד 3");
  assert.equal(numberRangeLine(num({ max: 3, unit: " mA " }), "", false).text, "טווח מותר · עד 3 mA");
});

test("no range: nothing to say until something is wrong, and then the word alone", () => {
  const free = num({});
  assert.equal(numberRangeForm(free), null);
  assert.equal(numberRangeLine(free, "", false).visible, false);
  assert.equal(numberRangeLine(free, "12", false).visible, false);
  const nan = numberRangeLine(free, "abc", false);
  assert.deepEqual([nan.visible, nan.text, nan.segments], [true, "יש להזין מספר", [{ text: "יש להזין מספר" }]]);
  assert.equal(numberRangeLine(free, "", true).text, "יש להזין ערך");
  // A reference value without a tolerance is not a range (evaluate.ts numberInRange).
  assert.equal(numberRangeForm(num({ ref: 0.1 })), null);
});

test("reference ± tolerance: the COPY-PENDING wording, inclusive like the evaluator", () => {
  const { rangeRef, rangeTolerance } = WORKER_COPY_PENDING;
  const refTol = num({ ref: 0.1, tol_pct: 10 });
  assert.equal(numberRangeLine(refTol, "", false).text, `טווח מותר · ${rangeRef} 0.1 Ω · ${rangeTolerance} ±10%`);
  assert.deepEqual(numberRangeForm(refTol)?.filter((s) => s.ltr).map((s) => s.text), ["0.1 Ω", "±10%"]);
  assert.equal(numberRangeLine(refTol, "0.09", false).state, "in");
  assert.equal(numberRangeLine(refTol, "0.115", false).state, "out");

  const both = num({ max: 0.2, ref: 0.1, tol_pct: 10 });
  assert.equal(numberRangeLine(both, "", false).text, `טווח מותר · עד 0.2 Ω · ${rangeRef} 0.1 Ω · ${rangeTolerance} ±10%`);
});
