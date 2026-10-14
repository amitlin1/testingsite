import { test } from "node:test";
import assert from "node:assert/strict";
import type { NumberField } from "@/app/lib/station-fields/schema";
import { parseRouteFieldsConfig } from "@/app/lib/station-fields/validate";
import { UNDRAWN_TEXT } from "../labels";
import {
  formatDecimal, numberPreviewMessage, numberRangeInverted, numberRangeShort, numberSummaryParts, numberSummaryText,
  parseDecimalText, toleranceNegative, withHelp, withNumberSetting, withUnit,
} from "../numberText";

const base: NumberField = {
  id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", out_of_range_fail: true,
};
const num = (over: Partial<NumberField>): NumberField => ({ ...base, ...over });

test("typed text: ',' reads as '.', empty is not set, anything else is not a number", () => {
  assert.equal(parseDecimalText(""), undefined);
  assert.equal(parseDecimalText("   "), undefined);
  assert.equal(parseDecimalText("0.1"), 0.1);
  assert.equal(parseDecimalText("0,1"), 0.1);
  assert.equal(parseDecimalText(" 5 "), 5);
  assert.equal(parseDecimalText("-2.5"), -2.5);
  assert.equal(parseDecimalText("+3"), 3);
  assert.equal(parseDecimalText(".5"), 0.5);
  assert.equal(parseDecimalText("5."), 5);
  for (const bad of ["-", ".", "abc", "1e3", "0x10", "1.2.3", "5 Ω", "Infinity", "1,2,3"]) {
    assert.equal(parseDecimalText(bad), null, bad);
  }
  assert.equal(formatDecimal(undefined), "");
  assert.equal(formatDecimal(0), "0");
  assert.equal(formatDecimal(0.1), "0.1");
});

test("a setting is set or removed; removing the reference removes the tolerance", () => {
  const withRef = withNumberSetting(withNumberSetting(base, "ref", 0.05), "tol_pct", 10);
  assert.deepEqual([withRef.ref, withRef.tol_pct], [0.05, 10]);
  const cleared = withNumberSetting(withRef, "ref", undefined);
  assert.equal("ref" in cleared, false);
  assert.equal("tol_pct" in cleared, false);
  assert.equal(withRef.ref, 0.05, "the input field is left alone");
  const noMax = withNumberSetting(num({ max: 0.1 }), "max", undefined);
  assert.equal("max" in noMax, false);
  // Whatever the settings do, the draft keeps passing the shape check (tol_pct never without ref).
  const step = {
    uid: "s_aaaaaaaa", station_type_id: 7, station_label: "חשמל", scope: "item",
    groups: [{
      target: "item",
      fields: [cleared, { ...withRef, id: "f_gnd00002" }, { ...noMax, id: "f_gnd00003" }],
    }],
  };
  assert.doesNotThrow(() => parseRouteFieldsConfig({ schema: 1, steps: { s_aaaaaaaa: step } }));
});

test("unit and help: an empty value is never stored", () => {
  assert.equal(withUnit(base, "Ω").unit, "Ω");
  assert.equal("unit" in withUnit(num({ unit: "Ω" }), ""), false);
  assert.equal(withHelp(base, "מדוד בין פין ההארקה לגוף המארז").help, "מדוד בין פין ההארקה לגוף המארז");
  assert.equal(withHelp(base, "שתי מילים ").help, "שתי מילים ", "typed text is kept as typed");
  assert.equal("help" in withHelp(num({ help: "x" }), "  "), false);
});

test("the range checks of NUMBER_RANGE", () => {
  assert.equal(numberRangeInverted(num({ min: 2, max: 1 })), true);
  assert.equal(numberRangeInverted(num({ min: 1, max: 1 })), false);
  assert.equal(numberRangeInverted(num({ min: 2 })), false);
  assert.equal(toleranceNegative(num({ ref: 1, tol_pct: -1 })), true);
  assert.equal(toleranceNegative(num({ ref: 1, tol_pct: 0 })), false);
});

test("the summary button (artboard 3 rangeShort)", () => {
  assert.equal(numberRangeShort(base), "ללא טווח");
  assert.equal(numberRangeShort(num({ max: 0.1 })), "מקס׳ 0.1");
  assert.equal(numberRangeShort(num({ min: 3 })), "מינ׳ 3");
  assert.equal(numberRangeShort(num({ min: 1, max: 2 })), "1–2");
  assert.equal(numberRangeShort(num({ ref: 0.05, tol_pct: 10 })), UNDRAWN_TEXT.numberRefShort + " 0.05 ±10%");
  assert.equal(numberRangeShort(num({ ref: 0.05 })), "ללא טווח", "a reference without a tolerance is no range");
  assert.equal(numberSummaryText(num({ unit: "Ω", max: 0.1 })), "יחידה Ω · מקס׳ 0.1 · מספר");
  assert.equal(numberSummaryText(num({ unit: "Ω" })), "יחידה Ω · ללא טווח · מספר");
  assert.equal(numberSummaryText(num({ min: 1, max: 2 })), "1–2 · מספר");
  assert.deepEqual(numberSummaryParts(num({ unit: " Ω ", max: 0.1 })), { unit: "Ω", range: "מקס׳ 0.1", type: "מספר" });
});

test("the live preview's line (artboard 3 rangeMsg)", () => {
  const gnd = num({ unit: "Ω", max: 0.1 });
  const inside = numberPreviewMessage(gnd, 0.08);
  assert.equal(inside.text, "בטווח · עד 0.1 Ω");
  assert.equal(inside.tone, "success");
  assert.deepEqual(inside.segments, [{ text: "בטווח · " }, { text: "עד " }, { text: "0.1 Ω", ltr: true }]);
  const out = numberPreviewMessage(gnd, 0.2);
  assert.equal(out.text, "מחוץ לטווח · עד 0.1 Ω · יסומן לא תקין");
  assert.equal(out.tone, "danger");
  assert.equal(numberPreviewMessage({ ...gnd, out_of_range_fail: false }, 0.2).text, "מחוץ לטווח · עד 0.1 Ω");
  assert.equal(numberPreviewMessage(num({ unit: "Ω", min: 1 }), 2).text, "בטווח · מעל 1 Ω");
  assert.equal(numberPreviewMessage(num({ unit: "Ω", min: 1, max: 2 }), 2).text, "בטווח · 1–2 Ω", "inclusive");
  assert.equal(numberPreviewMessage(num({ min: 1, max: 2 }), 3).text, "מחוץ לטווח · 1–2 · יסומן לא תקין", "no unit");
  const none = numberPreviewMessage(num({ unit: "Ω" }), 0.08);
  assert.deepEqual([none.state, none.text, none.tone], ["none", "ללא טווח מוגדר", "muted"]);
  const idle = numberPreviewMessage(gnd, null);
  assert.deepEqual([idle.state, idle.text, idle.tone], ["idle", "טווח מותר · עד 0.1 Ω", "muted"]);
  // A reference ± tolerance is a range of its own (evaluate.ts numberInRange).
  const ref = num({ unit: "Ω", ref: 1, tol_pct: 10 });
  assert.equal(numberPreviewMessage(ref, 1.05).state, "in");
  assert.equal(numberPreviewMessage(ref, 1.2).state, "out");
});
