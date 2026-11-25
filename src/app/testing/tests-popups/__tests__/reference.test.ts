// Which reference an opened package item is compared against (spec: ייחוס מארז §3.4), and how a
// lookup's answer is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gramsOf, positiveGramsOf, resolveItemReference, stationImagesOf, type FoundReference, type RefMember } from "../reference";

const img = (id: number) => ({ id, url: `/r/${id}.jpg` });
const EXPECTED: RefMember = { itemTypeId: 5, sku: "HP-PC-800", name: "HP EliteDesk 800", refWeight: 5400, images: [img(1), img(2)] };
const FOUND: FoundReference = { hasRU: true, name: "HP EliteDesk 600", refWeight: 5000, images: [img(3)] };
const NOTHING: FoundReference = { hasRU: false, name: null, refWeight: null, images: [] };

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
  assert.deepEqual(r.images, EXPECTED.images);
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
  assert.equal(gramsOf("0"), 0, "the package wizards keep a 0 (B9)");
});

test("positiveGramsOf: the item popups count a weight only above 0 (B9)", () => {
  assert.equal(positiveGramsOf(" 500 "), 500);
  assert.equal(positiveGramsOf(12.5), 12.5);
  for (const none of [null, undefined, "", "0", 0, -3, "0.5kg"]) assert.equal(positiveGramsOf(none), null, String(none));
});

test("stationImagesOf: the images of the station type the lookup was asked at", () => {
  const byStation = { 3: [img(1)], 7: [img(2), img(3)] };
  assert.deepEqual(stationImagesOf(byStation, 7), [img(2), img(3)]);
  assert.deepEqual(stationImagesOf(byStation, 9), []);
  for (const none of [null, undefined, "x", { 7: "not a list" }]) assert.deepEqual(stationImagesOf(none, 7), []);
});
