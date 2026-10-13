// normalizeTestDetails (the test-results report's reader of test_results.details) against every
// shape the popups write today and the shape station fields add (route-fields spec §8.1, §8.12):
// nothing throws, and what a report row showed before it still shows.
//
// The station-fields block is { schema, fields: { <field id>: value }, verdict }. Its `fields` is
// an OBJECT, while the report's preferred legacy shape is a `fields` ARRAY (testDetails.ts), so
// this reader skips the block silently — no fields are shown for it yet (open decision §10.2-5).
// These tests pin exactly that: skipped, never misread, never a crash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTestDetails } from "../testDetails";

const labels = (details: unknown) => normalizeTestDetails(details).map((f) => f.label);
const valueOf = (details: unknown, label: string) => normalizeTestDetails(details).find((f) => f.label === label)?.value;

/** What the station-fields block adds to Details (spec §2.5) — the same on every popup. */
const BLOCK = {
  schema: { route_id: 7, v: 2, step_uid: "s_abcd1234", target: "item" },
  fields: {
    f_led00001: { t: "choice_row", label: "LED", opt: "o_led00003", opt_label: "off", tone: "fail", note: "dark" },
    f_gnd00001: { t: "number", label: "Ground", value: 0.2, unit: "Ω", in_range: false },
    f_ins00001: { t: "pass_fail", label: "Insulation", ok: "pass" },
  },
  verdict: { ok: "pass", note: "", suggested: "fail", overridden: true },
};

// Today's shapes, by popup (spec §0.2), with fixture values.
const VERDICT_STATION = { station: "type-20", sku: "SKU-1", verdict: { ok: "pass", note: "" } };
const PHOTO_STATION = { station: "type-20", sku: "SKU-1", hasRU: false, photo: { ok: "fail", note: "x", photos: ["k/1.jpg"] } };
const OPEN_ITEM = {
  sku: "SKU-1", hasRU: false, weight: { reference: 1.2, measured: 1.25, diffPct: 4.2, pass: true },
  product: { ok: "pass", note: "", photos: ["k/2.jpg"] }, package_id: "100512", opening: true,
};
const OPEN_BOX = {
  sku: "BOX-1", hasRU: null, pkg: { ok: "pass", note: "", photos: [] },
  itemCount: 2, registeredCount: 2, templateCount: 2, labelsPrinted: true, packageItemIds: ["1", "2"], opening: true,
};
const CLOSE_ITEM = { closing: true, packed: true, package_id: "100512" };
const CLOSE_BOX = {
  sku: "BOX-1", hasRU: null, closing: true, checks: [{ label: "c1", ok: true }], note: "",
  packed: ["1"], decisions: [{ item_id: "2", decision: "missing", note: "" }],
};

test("normalizeTestDetails: today's shapes — no Details at all, and every wizard's — show their scalar keys", () => {
  assert.deepEqual(normalizeTestDetails(null), []);         // PopUpTestDialog sends no Details
  assert.deepEqual(normalizeTestDetails(undefined), []);
  assert.deepEqual(labels(VERDICT_STATION), ["station", "sku"]);
  assert.deepEqual(labels(PHOTO_STATION), ["station", "sku", "hasRU"]);
  assert.deepEqual(labels(OPEN_ITEM), ["sku", "hasRU", "package_id", "opening"]);
  assert.deepEqual(labels(OPEN_BOX), ["sku", "hasRU", "itemCount", "registeredCount", "templateCount", "labelsPrinted", "opening"]);
  assert.deepEqual(labels(CLOSE_ITEM), ["closing", "packed", "package_id"]);
  assert.deepEqual(labels(CLOSE_BOX), ["sku", "hasRU", "closing", "note"]);
  assert.equal(valueOf(VERDICT_STATION, "station"), "type-20");
  assert.equal(valueOf(PHOTO_STATION, "sku"), "SKU-1");
});

test("normalizeTestDetails: with the station-fields block added, every popup's row shows exactly what it showed before — the block is skipped, nothing throws", () => {
  for (const legacy of [VERDICT_STATION, PHOTO_STATION, OPEN_ITEM, OPEN_BOX, CLOSE_ITEM, CLOSE_BOX]) {
    assert.deepEqual(normalizeTestDetails({ ...legacy, ...BLOCK }), normalizeTestDetails(legacy), JSON.stringify(legacy));
  }
  // PopUpTestDialog with fields: the block is all its Details.
  assert.deepEqual(normalizeTestDetails(BLOCK), []);
  // The close wizard's box: a "packed anyway" decision carries the item's fields.
  const closing = {
    ...CLOSE_BOX, ...BLOCK,
    decisions: [{ item_id: "2", decision: "packed_anyway", note: "", fields: BLOCK.fields, suggested: "fail" }],
  };
  assert.deepEqual(labels(closing), ["sku", "hasRU", "closing", "note"]);
});

test("normalizeTestDetails: the legacy `fields` array is still read as fields — the block's `fields` object never reaches that branch", () => {
  const legacyFields = { fields: [{ label: "Voltage", value: 5, unit: "V", min: 4, max: 6 }] };
  assert.deepEqual(normalizeTestDetails(legacyFields), [{ label: "Voltage", value: "5", unit: "V", spec: "4 – 6", status: "pass" }]);
  assert.deepEqual(normalizeTestDetails({ fields: BLOCK.fields }), [], "an object of field values is not a field list");
  assert.deepEqual(normalizeTestDetails([{ label: "Voltage", value: 7, max: 6 }]).map((f) => f.status), ["fail"]);
});
