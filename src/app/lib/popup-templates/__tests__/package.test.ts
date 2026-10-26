import { test } from "node:test";
import assert from "node:assert/strict";
import { allComponentsOf, photoCodesOf } from "../schema";
import type { PopupTemplateConfig, TemplateComponent } from "../schema";
import { TemplateShapeError, lintPopupTemplate, parsePopupTemplateConfig } from "../validate";
import { closingTemplate, openingTemplate, verdictStationTemplate } from "../templates";

const codes = (cfg: PopupTemplateConfig, base: "item" | "package" = "package") => lintPopupTemplate(cfg, base).map((i) => i.code);
const clone = (cfg: PopupTemplateConfig): PopupTemplateConfig => JSON.parse(JSON.stringify(cfg));
const kinds = (cfg: PopupTemplateConfig) => cfg.steps.map((s) => s.components.map((c) => c.kind));

test("today's two package wizards are valid package templates, unchanged by the shape parse", () => {
  const open = openingTemplate("pkg", "prod");
  const close = closingTemplate();
  for (const cfg of [open, close]) {
    assert.deepEqual(lintPopupTemplate(cfg, "package"), []);
    assert.deepEqual(parsePopupTemplateConfig(clone(cfg)), cfg);
  }
  assert.deepEqual(kinds(open), [["sku_scan"], ["message", "photo", "route_fields", "verdict"], ["contents"], ["items"], ["labels"]]);
  assert.deepEqual(open.item_flow!.map((s) => s.components.map((c) => c.kind)), [["sku_scan"], ["message", "photo", "route_fields", "verdict"], ["message", "weight"]]);
  assert.deepEqual(photoCodesOf(open), ["pkg", "prod"], "the box's group and the items' — the item flow counts");
  assert.deepEqual(kinds(close), [["sku_scan"], ["arrival"], ["route_fields", "checklist", "notes"]]);
  const checks = allComponentsOf(close).find((c) => c.kind === "checklist") as Extract<TemplateComponent, { kind: "checklist" }>;
  assert.equal(checks.items.length, 3);
});

test("a package template is not an item template, and the reverse", () => {
  assert.ok(codes(openingTemplate("pkg", "prod"), "item").includes("ROLE_ON_ITEM"));
  assert.ok(codes(closingTemplate(), "item").includes("KIND_NOT_ALLOWED"), "arrival is not an item station's");
  const noRole = clone(closingTemplate());
  delete noRole.role;
  assert.ok(codes(noRole).includes("ROLE_MISSING"));
  assert.deepEqual(codes(verdictStationTemplate(), "item"), [], "phase 1 unchanged");
});

test("the system parts: required, alone, in order, in their role only", () => {
  const noContents = clone(openingTemplate("pkg", "prod"));
  noContents.steps.splice(2, 1);
  assert.deepEqual(codes(noContents), ["SYSTEM_MISSING"]);

  const swapped = clone(openingTemplate("pkg", "prod"));
  [swapped.steps[2], swapped.steps[3]] = [swapped.steps[3], swapped.steps[2]];
  assert.deepEqual(codes(swapped), ["SYSTEM_ORDER"]);

  const crowded = clone(openingTemplate("pkg", "prod"));
  crowded.steps[2].components.push({ id: "k_extramsg", kind: "message", text: "x" });
  assert.deepEqual(codes(crowded), ["SYSTEM_NOT_ALONE"]);

  const arrivalInOpening = clone(openingTemplate("pkg", "prod"));
  arrivalInOpening.steps.push({ id: "p_arrival1", title: "הגעה", desc: "", components: [{ id: "k_arrival1", kind: "arrival" }] });
  assert.deepEqual(codes(arrivalInOpening), ["KIND_NOT_ALLOWED"]);

  const noArrival = clone(closingTemplate());
  noArrival.steps.splice(1, 1);
  assert.deepEqual(codes(noArrival), ["SYSTEM_MISSING"]);

  const labelsOptional = clone(openingTemplate("pkg", "prod"));
  labelsOptional.steps.pop();
  assert.deepEqual(codes(labelsOptional), [], "labels may go");
});

test("the item flow: an opening needs one, a closing has none; its own SKU and verdict rules", () => {
  const empty = clone(openingTemplate("pkg", "prod"));
  empty.item_flow = [];
  assert.deepEqual(codes(empty), ["ITEM_FLOW_EMPTY"]);

  const inClosing = clone(closingTemplate());
  inClosing.item_flow = clone(openingTemplate("pkg", "prod")).item_flow;
  assert.ok(codes(inClosing).includes("ITEM_FLOW_NOT_HERE"));

  const skuLate = clone(openingTemplate("pkg", "prod"));
  skuLate.item_flow!.reverse();
  assert.ok(codes(skuLate).includes("SKU_NOT_FIRST"));

  const verdictEarly = clone(openingTemplate("pkg", "prod"));
  const photoPhase = verdictEarly.item_flow![1].components;
  [photoPhase[2], photoPhase[3]] = [photoPhase[3], photoPhase[2]];
  assert.deepEqual(codes(verdictEarly), ["VERDICT_NOT_LAST_IN_STEP"]);

  const noLookup = clone(openingTemplate("pkg", "prod"));
  (noLookup.item_flow![0].components[0] as { lookup_reference: boolean }).lookup_reference = false;
  assert.deepEqual(codes(noLookup), ["NEEDS_REFERENCE", "NEEDS_REFERENCE"], "the item's photo and weight lean on its own lookup");
});

test("no verdict is fine in a package template; checklist and notes content", () => {
  const noVerdict = clone(openingTemplate("pkg", "prod"));
  noVerdict.steps[1].components.pop();
  assert.deepEqual(codes(noVerdict), []);

  const close = clone(closingTemplate());
  const checklist = close.steps[2].components[1] as Extract<TemplateComponent, { kind: "checklist" }>;
  checklist.title = "";
  checklist.items[1].label = " ";
  (close.steps[2].components[2] as { label: string }).label = "";
  assert.deepEqual(codes(close).sort(), ["CHECKLIST_ITEM_EMPTY", "CHECKLIST_TITLE_EMPTY", "NOTES_LABEL_EMPTY"]);
  checklist.items = [];
  assert.ok(codes(close).includes("CHECKLIST_EMPTY"));
});

test("the shape parse: role, item flow, checklist rows, unique ids across all of them", () => {
  const bad: Array<[string, (c: PopupTemplateConfig) => void]> = [
    ["role", (c) => { (c as { role: string }).role = "middle"; }],
    ["flow not a list", (c) => { (c as unknown as { item_flow: number }).item_flow = 3; }],
    ["checklist row id", (c) => { (c.steps[2].components[1] as { items: { id: string }[] }).items[0].id = "x"; }],
    ["duplicate across the flow", (c) => { c.item_flow = [{ ...c.steps[1], components: [] }]; }],
  ];
  for (const [what, mutate] of bad) {
    const c = clone(closingTemplate());
    mutate(c);
    assert.throws(() => parsePopupTemplateConfig(c), TemplateShapeError, what);
  }
});
