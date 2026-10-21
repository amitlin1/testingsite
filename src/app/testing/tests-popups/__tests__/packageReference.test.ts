// Which reference an opened package item is compared against (spec: ייחוס מארז §3.4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gramsOf, resolveItemReference, type FoundReference, type RefMember } from "../packageReference";

const img = (id: number) => ({ id, url: `/r/${id}.jpg` });
const EXPECTED: RefMember = { itemTypeId: 5, sku: "HP-PC-800", name: "HP EliteDesk 800", refWeight: 5400, imagesByType: { product: [img(1), img(2)] } };
const FOUND: FoundReference = { hasRU: true, name: "HP EliteDesk 600", refWeight: 5000, imagesByType: { product: [img(3)] } };
const NOTHING: FoundReference = { hasRU: false, name: null, refWeight: null, imagesByType: {} };

test("resolveItemReference: the expected SKU → the package reference's member", () => {
  const r = resolveItemReference(" HP-PC-800 ", EXPECTED, FOUND, "מחשב");
  assert.equal(r.source, "package");
  assert.equal(r.tone, "ok");
  assert.equal(r.name, "HP EliteDesk 800");
  assert.equal(r.refWeight, 5400);
  assert.equal(r.expectedSku, "HP-PC-800");
  assert.match(r.text, /^תואם לייחוס המארז · HP EliteDesk 800 · 2 תמונות ייחוס · 5400 גר׳$/);
});

test("resolveItemReference: another SKU that has a reference item → that item, flagged", () => {
  const r = resolveItemReference("HP-PC-600", EXPECTED, FOUND, "מחשב");
  assert.equal(r.source, "scan");
  assert.equal(r.tone, "warn");
  assert.equal(r.name, "HP EliteDesk 600");
  assert.equal(r.expectedSku, "HP-PC-800");
  assert.match(r.text, /שונה מהמצופה בייחוס המארז \(HP-PC-800\)/);
});

test("resolveItemReference: another SKU that nothing has → the expected member, flagged", () => {
  const r = resolveItemReference("ABC-123", EXPECTED, NOTHING, "מחשב");
  assert.equal(r.source, "package_fallback");
  assert.equal(r.tone, "warn");
  assert.equal(r.hasRU, true);
  assert.equal(r.refWeight, 5400);
  assert.deepEqual(r.imagesByType, EXPECTED.imagesByType);
});

test("resolveItemReference: no member for the type → as before the package reference", () => {
  const found = resolveItemReference("HP-PC-600", null, FOUND, "מחשב");
  assert.deepEqual([found.source, found.tone, found.expectedSku], ["scan", "ok", null]);
  assert.match(found.text, /^נמצא פריט ייחוס · HP EliteDesk 600 · 1 תמונות ייחוס · 5000 גר׳$/);
  const none = resolveItemReference("ABC-123", null, NOTHING, "מחשב");
  assert.deepEqual([none.source, none.tone, none.hasRU], ["none", "warn", false]);
  assert.match(none.text, /לא נמצא פריט ייחוס של מחשב/);
});

test("gramsOf: a number is grams; anything else is no weight", () => {
  assert.equal(gramsOf("500"), 500);
  assert.equal(gramsOf("12.5"), 12.5);
  assert.equal(gramsOf(null), null);
  assert.equal(gramsOf(""), null);
  assert.equal(gramsOf("0.5kg"), null, "the old free text never compared — it is no weight, not NaN");
});
