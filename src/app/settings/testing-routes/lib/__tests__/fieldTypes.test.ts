import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_TYPES } from "@/app/lib/station-fields/schema";
import { FIELD_TYPE_TEXT } from "../labels";
import { DEFAULT_FIELD_TYPE, FIELD_TYPE_GROUPS, activeTypeIn, filterFieldTypes, stepActiveType, visibleTypes } from "../fieldTypes";

test("the picker lists every type once, in FIELD_TYPES order, in artboard 3's five groups", () => {
  assert.deepEqual(visibleTypes(FIELD_TYPE_GROUPS), [...FIELD_TYPES]);
  assert.deepEqual(FIELD_TYPE_GROUPS.map((g) => g.name), ["נפוץ", "מדידה וטקסט", "בחירה", "תיעוד", "מבנה"]);
  assert.equal(DEFAULT_FIELD_TYPE, "choice_row");
  assert.equal(FIELD_TYPE_TEXT.choice_row.desc, "שם · בחירה מ-4 אפשרויות · הערות");
  assert.equal(FIELD_TYPE_TEXT.number.desc, "ערך עם יחידה, טווח או ערך ייחוס ±%");
});

test("search by name or description; empty groups drop out", () => {
  assert.deepEqual(visibleTypes(filterFieldTypes("")), [...FIELD_TYPES]);
  assert.deepEqual(visibleTypes(filterFieldTypes("  ")), [...FIELD_TYPES]);
  assert.deepEqual(visibleTypes(filterFieldTypes("צילום")), ["photo"]);
  assert.deepEqual(visibleTypes(filterFieldTypes("ייחוס")), ["number"], "by description");
  assert.deepEqual(visibleTypes(filterFieldTypes("טקסט")), ["text", "textarea"]);
  assert.deepEqual(filterFieldTypes("טקסט").map((g) => g.name), ["מדידה וטקסט"]);
  assert.deepEqual(visibleTypes(filterFieldTypes("מספר")), ["number"]);
  assert.deepEqual(filterFieldTypes("xyz"), []);
});

test("arrows walk the visible rows and wrap; the active row falls back to the first", () => {
  const list = visibleTypes(filterFieldTypes("טקסט"));
  assert.equal(stepActiveType(list, "text", 1), "textarea");
  assert.equal(stepActiveType(list, "textarea", 1), "text");
  assert.equal(stepActiveType(list, "text", -1), "textarea");
  assert.equal(stepActiveType(list, "photo", 1), "text", "an active row that is filtered out");
  assert.equal(stepActiveType(list, null, -1), "textarea");
  assert.equal(stepActiveType([], "text", 1), null);
  assert.equal(activeTypeIn(list, "textarea"), "textarea");
  assert.equal(activeTypeIn(list, "choice_row"), "text");
  assert.equal(activeTypeIn([], "choice_row"), null);
});
