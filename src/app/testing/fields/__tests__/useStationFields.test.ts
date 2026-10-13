import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Field, StationFieldsResponse } from "@/app/lib/station-fields/schema";
import { findKitItem, kitItemDefs, parseStationFieldsResponse, stationFieldsQuery, useStationFields } from "../useStationFields";
import type { StationFieldsState } from "../useStationFields";

const fields: Field[] = [
  { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", options: [{ id: "o_led00001", label: "תקין", tone: "pass" }] },
  { id: "f_sec00001", type: "section", label: "בטיחות חשמלית" },
];
/** A group of one item type's own. */
const screenFields: Field[] = [{ id: "f_scr00001", type: "pass_fail", label: "ברגי VESA", required: true, notes: "optional" }];
const item: Extract<StationFieldsResponse, { mode: "item" }> = {
  mode: "item", schema: { route_id: 77, v: 5, step_uid: "s_abcd1234", target: "item" }, fields, gate: true,
};
const pkg: Extract<StationFieldsResponse, { mode: "package" }> = {
  mode: "package",
  schema: { route_id: 91, v: 5, step_uid: "s_k1open00" },
  box: fields,
  items: [
    { item_id: "1005150926000301", package_seq: 1, item_type_id: 3, item_type_desc: "מחשב", groups: [{ target: "each_item", fields }] },
    { item_id: "1005150926000302", package_seq: 2, item_type_id: 4, item_type_desc: "מסך", groups: [{ target: "each_item", fields }, { target: { item_type_id: 4 }, fields: screenFields }] },
    { item_id: "1005150926000303", package_seq: 3, item_type_id: 5, item_type_desc: "מקלדת", groups: [] },
  ],
  gate: true,
};
/** What the wire carries: the response through JSON. */
const wire = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

test("the three modes come through as they were sent", () => {
  assert.deepEqual(parseStationFieldsResponse(wire({ mode: "legacy" })), { mode: "legacy" });
  assert.deepEqual(parseStationFieldsResponse(wire(item)), item);
  assert.deepEqual(parseStationFieldsResponse(wire(pkg)), pkg);
});

test("the schema reference is rebuilt from its own keys — what Details.schema sends back", () => {
  const extra = parseStationFieldsResponse(wire({ ...pkg, schema: { ...pkg.schema, target: "box", x: 1 } }));
  assert.deepEqual(extra?.mode === "package" ? extra.schema : null, { route_id: 91, v: 5, step_uid: "s_k1open00" });
  const itemExtra = parseStationFieldsResponse(wire({ ...item, schema: { ...item.schema, x: 1 } }));
  assert.deepEqual(itemExtra?.mode === "item" ? itemExtra.schema : null, item.schema);
});

test("anything else is not a response (→ the blocking error state, never legacy)", () => {
  const bad: unknown[] = [
    null, undefined, "legacy", [], {}, { mode: "other" },
    { ...item, gate: undefined },
    { ...item, gate: "true" },
    { ...item, schema: { ...item.schema, target: "box" } },
    { ...item, schema: { route_id: "77", v: 5, step_uid: "s_abcd1234", target: "item" } },
    { ...item, schema: undefined },
    { ...item, fields: undefined },
    { ...item, fields: [{ id: "f_led00001", type: "choice_row" }] },
    { ...item, fields: [null] },
    { ...pkg, box: undefined },
    { ...pkg, items: {} },
    { ...pkg, items: [{ ...pkg.items[0], item_id: 1005150926000301 }] },
    { ...pkg, items: [{ ...pkg.items[0], groups: undefined }] },
    { ...pkg, items: [{ ...pkg.items[0], groups: [{ target: "box", fields }] }] },
    { ...pkg, items: [{ ...pkg.items[0], groups: [{ target: { item_type_id: "4" }, fields }] }] },
    { ...pkg, items: [{ ...pkg.items[0], groups: [{ target: "each_item" }] }] },
  ];
  for (const raw of bad) assert.equal(parseStationFieldsResponse(wire(raw ?? null)), null, JSON.stringify(raw));
});

test("a kit item's entry and its fields, groups in order", () => {
  const reload = () => {};
  const ready: StationFieldsState = { status: "ready", reload, ...pkg };
  assert.equal(findKitItem(ready, "1005150926000302"), pkg.items[1]);
  assert.equal(findKitItem(ready, 1005150926000302), pkg.items[1]);
  assert.equal(findKitItem(ready, "1"), undefined);
  assert.equal(findKitItem({ status: "ready", reload, ...item }, "1005150926000302"), undefined);
  assert.equal(findKitItem({ status: "loading", reload }, "1005150926000302"), undefined);
  assert.equal(findKitItem({ status: "legacy", reload }, "1005150926000302"), undefined);
  assert.deepEqual(kitItemDefs(pkg.items[1]).map((f) => f.id), ["f_led00001", "f_sec00001", "f_scr00001"]);
  assert.deepEqual(kitItemDefs(pkg.items[2]), []);
  assert.deepEqual(kitItemDefs(undefined), []);
});

test("every state can ask again, not only 'ready' (spec §4.11.3, §8.6)", () => {
  // A closed popup is "loading" (the hook does not fetch while closed).
  const seen: StationFieldsState[] = [];
  const Probe = () => {
    seen.push(useStationFields(42, false, 7));
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, "loading");
  assert.equal(typeof seen[0].reload, "function");
});

test("the query: itemId, and stationId only when it is one", () => {
  assert.equal(stationFieldsQuery(42, 7), "itemId=42&stationId=7");
  assert.equal(stationFieldsQuery("1005150926000300"), "itemId=1005150926000300");
  assert.equal(stationFieldsQuery(42, null), "itemId=42");
  assert.equal(stationFieldsQuery(42, 0), "itemId=42");
  assert.equal(stationFieldsQuery(42, Number.NaN), "itemId=42");
  assert.equal(stationFieldsQuery(42, 1.5), "itemId=42");
});
