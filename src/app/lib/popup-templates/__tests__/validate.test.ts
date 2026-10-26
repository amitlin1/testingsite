import { test } from "node:test";
import assert from "node:assert/strict";
import { fillVariables, photoCodesOf, skuScanOf } from "../schema";
import type { PopupTemplateConfig, TemplateComponent } from "../schema";
import { TemplateShapeError, lintPopupTemplate, parsePopupTemplateConfig, parseTemplateBase } from "../validate";
import { photoStationTemplate, verdictStationTemplate } from "../templates";

/** A deterministic random source: ids differ per call, the same in every run. */
function seeded() {
  let n = 0;
  return (bytes: Uint8Array<ArrayBuffer>) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (n++ * 37 + 11) % 252;
    return bytes;
  };
}

const codes = (cfg: PopupTemplateConfig) => lintPopupTemplate(cfg).map((i) => i.code);
const clone = (cfg: PopupTemplateConfig): PopupTemplateConfig => JSON.parse(JSON.stringify(cfg));

test("today's two popups are valid templates, and survive the shape parse unchanged", () => {
  for (const cfg of [photoStationTemplate("grp_3", seeded()), verdictStationTemplate(seeded())]) {
    assert.deepEqual(lintPopupTemplate(cfg), []);
    assert.deepEqual(parsePopupTemplateConfig(clone(cfg)), cfg);
  }
  const photo = photoStationTemplate("grp_3", seeded());
  assert.deepEqual(photoCodesOf(photo), ["grp_3"]);
  assert.equal(skuScanOf(photo)?.lookup_reference, true);
  assert.equal(skuScanOf(verdictStationTemplate(seeded()))?.lookup_reference, false);
});

test("the shape parse drops unknown keys and refuses what the editor never sends", () => {
  const raw = clone(verdictStationTemplate(seeded())) as unknown as Record<string, unknown>;
  (raw as { extra?: number }).extra = 1;
  ((raw.steps as Record<string, unknown>[])[0] as { hack?: string }).hack = "x";
  const parsed = parsePopupTemplateConfig(raw);
  assert.equal("extra" in parsed, false);
  assert.equal("hack" in parsed.steps[0], false);

  const bad: Array<[string, (c: PopupTemplateConfig) => void]> = [
    ["bad step id", (c) => { c.steps[0].id = "s_12345678"; }],
    ["bad component id", (c) => { c.steps[0].components[0].id = "f_12345678"; }],
    ["unknown kind", (c) => { (c.steps[1].components[0] as unknown as { kind: string }).kind = "xray"; }],
    ["duplicate id", (c) => { c.steps[1].id = c.steps[0].id; }],
    ["photo min out of range", (c) => { (c.steps[1].components[0] as { min: number }).min = 21; }],
    ["photo code", (c) => { (c.steps[1].components[0] as { photo_code: string }).photo_code = "a b"; }],
    ["note length", (c) => { (c.steps[1].components[2] as { note_max: number }).note_max = 777; }],
    ["finish label", (c) => { (c as { finish_label: unknown }).finish_label = 5; }],
  ];
  for (const [what, mutate] of bad) {
    const c = clone(photoStationTemplate("grp_3", seeded()));
    mutate(c);
    assert.throws(() => parsePopupTemplateConfig(c), TemplateShapeError, what);
  }
  assert.throws(() => parsePopupTemplateConfig(null), TemplateShapeError);
  assert.throws(() => parsePopupTemplateConfig({ steps: [], finish_label: "x".repeat(41) }), TemplateShapeError);
  assert.equal(parseTemplateBase("item"), "item");
  assert.throws(() => parseTemplateBase("box"), TemplateShapeError);
});

test("the verdict: required, single, last", () => {
  const noVerdict = clone(verdictStationTemplate(seeded()));
  noVerdict.steps[1].components.pop();
  assert.deepEqual(codes(noVerdict), ["VERDICT_MISSING"]);

  const notLast = clone(verdictStationTemplate(seeded()));
  const comps = notLast.steps[1].components;
  [comps[1], comps[2]] = [comps[2], comps[1]];
  assert.deepEqual(codes(notLast), ["VERDICT_NOT_LAST"]);

  const twice = clone(verdictStationTemplate(seeded()));
  twice.steps[1].components.push({ ...twice.steps[1].components[2], id: "k_zzzzzzzz" } as TemplateComponent);
  assert.ok(codes(twice).includes("VERDICT_DUPLICATE"));

  const empty = clone(verdictStationTemplate(seeded()));
  (empty.steps[1].components[2] as { question: string }).question = " ";
  assert.deepEqual(codes(empty), ["VERDICT_QUESTION_EMPTY"]);
});

test("the SKU scan: alone in the first step, once", () => {
  const second = clone(verdictStationTemplate(seeded()));
  second.steps.reverse();
  assert.ok(codes(second).includes("SKU_NOT_FIRST"));

  const shared = clone(verdictStationTemplate(seeded()));
  shared.steps[0].components.push({ id: "k_mmmmmmmm", kind: "message", text: "x" });
  assert.ok(codes(shared).includes("SKU_NOT_FIRST"));

  const twice = clone(verdictStationTemplate(seeded()));
  twice.steps[1].components.unshift({ ...twice.steps[0].components[0], id: "k_ssssssss" } as TemplateComponent);
  assert.ok(codes(twice).includes("SKU_DUPLICATE"));
});

test("what needs the reference item needs a SKU scan that looks it up first", () => {
  const noLookup = clone(photoStationTemplate("grp_3", seeded()));
  (noLookup.steps[0].components[0] as { lookup_reference: boolean }).lookup_reference = false;
  assert.deepEqual(codes(noLookup), ["NEEDS_REFERENCE"]);

  const weight = clone(verdictStationTemplate(seeded()));
  weight.steps[1].components.unshift({ id: "k_wwwwwwww", kind: "weight", required: true, tolerance_pct: 5 });
  assert.deepEqual(codes(weight), ["NEEDS_REFERENCE"]);

  const noRef = clone(photoStationTemplate("grp_3", seeded()));
  (noRef.steps[0].components[0] as { lookup_reference: boolean }).lookup_reference = false;
  (noRef.steps[1].components[0] as { show_reference: boolean }).show_reference = false;
  assert.deepEqual(codes(noRef), [], "a photo without reference images needs no lookup");

  const tol = clone(photoStationTemplate("grp_3", seeded()));
  tol.steps[1].components.unshift({ id: "k_wwwwwwww", kind: "weight", required: true, tolerance_pct: 120 });
  assert.deepEqual(codes(tol), ["TOLERANCE"]);
});

test("steps, titles, photos, route fields, messages", () => {
  const empty: PopupTemplateConfig = { steps: [], finish_label: "סיום" };
  assert.deepEqual(codes(empty), ["STEPS_EMPTY"]);

  const many = clone(verdictStationTemplate(seeded()));
  for (let i = 0; i < 5; i++) many.steps.splice(1, 0, { id: `p_extra00${i}`, title: "שלב", desc: "", components: [{ id: `k_msg0000${i}`, kind: "message", text: "x" }] });
  assert.deepEqual(codes(many), ["STEPS_TOO_MANY"]);

  const blank = clone(verdictStationTemplate(seeded()));
  blank.steps[1].title = "";
  blank.finish_label = " ";
  (blank.steps[1].components[0] as { text: string }).text = "";
  blank.steps.splice(1, 0, { id: "p_emptyemp", title: "ריק", desc: "", components: [] });
  assert.deepEqual(codes(blank).sort(), ["FINISH_LABEL_EMPTY", "MESSAGE_EMPTY", "STEP_EMPTY", "STEP_TITLE_EMPTY"]);

  const photos = clone(photoStationTemplate("grp_3", seeded()));
  const photo = photos.steps[1].components[0];
  photos.steps[1].components.splice(1, 0, { ...photo, id: "k_photo002", title: "" } as TemplateComponent);
  photos.steps[1].components.splice(1, 0, { id: "k_fields02", kind: "route_fields" });
  assert.deepEqual(codes(photos).sort(), ["PHOTO_CODE_DUPLICATE", "PHOTO_TITLE_EMPTY", "ROUTE_FIELDS_DUPLICATE"]);
});

test("variables: the station type's name, the SKU, the model, the serial", () => {
  assert.equal(fillVariables("סיום בדיקת {עמדה}", { station: " מכלול " }), "סיום בדיקת מכלול");
  assert.equal(fillVariables("סיום בדיקת {עמדה}", {}), "סיום בדיקת העמדה");
  assert.equal(fillVariables("מק״ט {מק״ט} · {דגם} · {סריאלי}", { sku: "MK-1", model: "A1", serial: "" }), "מק״ט MK-1 · A1 · —");
  assert.equal(fillVariables("{מק״ט}/{מק״ט}", { sku: "X" }), "X/X");
});
