import { test } from "node:test";
import assert from "node:assert/strict";
import { lintPopupTemplate } from "@/app/lib/popup-templates/validate";
import type { PhotoComponent } from "@/app/lib/popup-templates/schema";
import {
  addChecklistRow, addComponent, addStep, blankTemplate, canAddKind, catalogFor, codeTemplateFor, isLockedStep, isSystemPart, issuesAt,
  moveComponent, moveStep, newComponent, packageCodeTemplate, removeChecklistRow, removeComponent, removeStep, sameConfig,
  setChecklistRow, setFinishLabel, templateIssues, updateComponent, updateStep,
} from "../editorModel";

const kinds = (cfg: ReturnType<typeof blankTemplate>, i: number) => cfg.steps[i].components.map((c) => c.kind);

test("a blank template is valid; a new photo component owns its group", () => {
  const cfg = blankTemplate();
  assert.deepEqual(lintPopupTemplate(cfg), []);
  assert.deepEqual(kinds(cfg, 1), ["route_fields", "verdict"]);
  const photo = newComponent("photo") as PhotoComponent;
  assert.equal(photo.photo_code, photo.id);
  assert.equal(photo.min, 0);
});

test("the code's popups as templates; the plain dialog has none", () => {
  assert.equal(codeTemplateFor(undefined, () => "x"), null);
  assert.equal(codeTemplateFor({ kind: "photo", photoTypeId: 3 }, () => null), null, "a photo group that is gone");
  const photo = codeTemplateFor({ kind: "photo", photoTypeId: 3 }, (id) => (id === 3 ? "grp3" : null))!;
  assert.equal((photo.steps[1].components[0] as PhotoComponent).photo_code, "grp3");
  assert.equal(codeTemplateFor({ kind: "verdict" }, () => null)!.steps[1].components[0].kind, "message");
});

test("steps: added before the verdict's step, edited, moved, removed", () => {
  let cfg = addStep(blankTemplate());
  assert.equal(cfg.steps.length, 3);
  assert.equal(cfg.steps[1].title, "שלב חדש");
  assert.deepEqual(kinds(cfg, 2), ["route_fields", "verdict"], "the verdict's step stays last");
  const id = cfg.steps[1].id;
  cfg = updateStep(cfg, id, { title: "צילום", desc: "תיאור" });
  assert.deepEqual([cfg.steps[1].title, cfg.steps[1].desc], ["צילום", "תיאור"]);
  cfg = moveStep(cfg, id, -1);
  assert.equal(cfg.steps[0].id, id);
  assert.equal(moveStep(cfg, id, -1), cfg, "no step before the first");
  cfg = removeStep(cfg, id);
  assert.equal(cfg.steps.length, 2);
});

test("components: added before a closing verdict, updated, moved across steps, removed", () => {
  let cfg = blankTemplate();
  const step = cfg.steps[1].id;
  cfg = addComponent(cfg, step, "photo");
  assert.deepEqual(kinds(cfg, 1), ["route_fields", "photo", "verdict"]);
  const photo = cfg.steps[1].components[1];
  cfg = updateComponent<PhotoComponent>(cfg, photo.id, { title: "צילום מקרוב", min: 2 });
  assert.deepEqual([(cfg.steps[1].components[1] as PhotoComponent).title, (cfg.steps[1].components[1] as PhotoComponent).min], ["צילום מקרוב", 2]);

  cfg = moveComponent(cfg, photo.id, -1);
  assert.deepEqual(kinds(cfg, 1), ["photo", "route_fields", "verdict"]);
  cfg = moveComponent(cfg, photo.id, -1);
  assert.deepEqual([kinds(cfg, 0), kinds(cfg, 1)], [["sku_scan", "photo"], ["route_fields", "verdict"]], "up from the top: to the end of the step before");
  cfg = moveComponent(cfg, photo.id, 1);
  assert.deepEqual([kinds(cfg, 0), kinds(cfg, 1)], [["sku_scan"], ["photo", "route_fields", "verdict"]], "down from the bottom: to the start of the next");
  cfg = removeComponent(cfg, photo.id);
  assert.deepEqual(kinds(cfg, 1), ["route_fields", "verdict"]);
});

test("the catalog: one SKU, one verdict, one place for the fields, up to 8 photos", () => {
  let cfg = blankTemplate();
  assert.equal(canAddKind(cfg, "sku_scan"), false);
  assert.equal(canAddKind(cfg, "verdict"), false);
  assert.equal(canAddKind(cfg, "route_fields"), false);
  assert.equal(canAddKind(cfg, "message"), true);
  for (let i = 0; i < 8; i++) cfg = addComponent(cfg, cfg.steps[1].id, "photo");
  assert.equal(canAddKind(cfg, "photo"), false);
  cfg = removeComponent(cfg, cfg.steps[0].components[0].id);
  assert.equal(canAddKind(cfg, "sku_scan"), true);
});

test("dirty check and where issues belong", () => {
  const cfg = blankTemplate();
  assert.equal(sameConfig(cfg, JSON.parse(JSON.stringify(cfg))), true);
  const edited = setFinishLabel(cfg, "");
  assert.equal(sameConfig(cfg, edited), false);
  const issues = lintPopupTemplate(updateStep(edited, cfg.steps[1].id, { title: "" }));
  assert.deepEqual(templateIssues(issues).map((i) => i.code), ["FINISH_LABEL_EMPTY"]);
  assert.deepEqual(issuesAt(issues, { stepId: cfg.steps[1].id }).map((i) => i.code), ["STEP_TITLE_EMPTY"]);
});

test("package templates: today's wizards are valid, the item flow is edited like the steps", () => {
  const open = packageCodeTemplate("opening");
  const close = packageCodeTemplate("closing");
  assert.deepEqual(lintPopupTemplate(open, "package"), []);
  assert.deepEqual(lintPopupTemplate(close, "package"), []);
  assert.deepEqual(catalogFor("closing", "steps").includes("arrival"), false, "a mandatory part is never in the catalog");
  assert.ok(catalogFor("opening", "steps").includes("labels"), "the labels may come back");

  // A step of the item flow: renamed, given a component, moved — the box's steps untouched.
  const phase = open.item_flow![2];
  let cfg = updateStep(open, phase.id, { title: "שקילה סופית" });
  cfg = addComponent(cfg, phase.id, "photo");
  cfg = moveStep(cfg, phase.id, -1);
  assert.deepEqual(cfg.item_flow!.map((p) => p.title), ["סריקה", "שקילה סופית", "צילום"]);
  assert.deepEqual(cfg.steps, open.steps);
  assert.deepEqual(lintPopupTemplate(cfg, "package"), [], "a second photo in the flow is fine");
  assert.equal(addStep(open, undefined, "item_flow").item_flow!.length, 4);
  assert.equal(addStep(open).steps.length, open.steps.length + 1, "a package template adds its step at the end");

  // Once per list: the item flow has its own SKU scan and verdict, so neither is offered there.
  assert.equal(canAddKind(open, "sku_scan", "item_flow"), false);
  assert.equal(canAddKind(open, "verdict", "steps"), false);
  // The closing has no item flow — an edit keeps it absent.
  assert.equal("item_flow" in updateStep(close, close.steps[0].id, { desc: "x" }), false);
});

test("system parts: the mandatory ones lock their step; the labels come back only into an empty step", () => {
  const open = packageCodeTemplate("opening");
  const contents = open.steps[2];
  assert.ok(isLockedStep(contents) && isSystemPart(contents.components[0]));
  assert.equal(isLockedStep(open.steps[4]), false, "the labels' step may go");
  const noLabels = removeComponent(open, open.steps[4].components[0].id);
  assert.equal(canAddKind(noLabels, "labels", "steps", noLabels.steps[1]), false, "not into a step with components");
  assert.equal(canAddKind(noLabels, "labels", "steps", noLabels.steps[4]), true, "into the empty step left behind");
  assert.equal(canAddKind(open, "labels", "steps", open.steps[4]), false, "not twice");
  assert.equal(canAddKind(open, "message", "steps", contents), false, "a system part's step takes nothing more");
});

test("a checklist's rows", () => {
  let rows = addChecklistRow([]);
  rows = setChecklistRow(rows, rows[0].id, "האריזה סגורה");
  rows = addChecklistRow(rows);
  assert.deepEqual(rows.map((r) => r.label), ["האריזה סגורה", ""]);
  assert.match(rows[1].id, /^i_[a-z0-9]{8}$/);
  assert.deepEqual(removeChecklistRow(rows, rows[1].id).map((r) => r.label), ["האריזה סגורה"]);
});
