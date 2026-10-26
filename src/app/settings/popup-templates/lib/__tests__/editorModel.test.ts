import { test } from "node:test";
import assert from "node:assert/strict";
import { lintPopupTemplate } from "@/app/lib/popup-templates/validate";
import type { PhotoComponent } from "@/app/lib/popup-templates/schema";
import {
  addComponent, addStep, blankTemplate, canAddKind, codeTemplateFor, issuesAt, moveComponent, moveStep, newComponent,
  removeComponent, removeStep, sameConfig, setFinishLabel, templateIssues, updateComponent, updateStep,
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
