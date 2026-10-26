import { test } from "node:test";
import assert from "node:assert/strict";
import { photoStationTemplate, verdictStationTemplate } from "@/app/lib/popup-templates/templates";
import type { PhotoComponent, PopupTemplateConfig, WeightComponent } from "@/app/lib/popup-templates/schema";
import {
  TEMPLATE_RUN_TEXT, buildTemplateDetails, emptyRunState, finishBlocker, routeFieldsSlot, stepBlocker, weightOutcome,
} from "../templateModel";

const CTX = { stationTypeId: 2, version: 4, station: "עמדה" };
const weightComp: WeightComponent = { id: "k_weight01", kind: "weight", required: true, tolerance_pct: 5 };

test("the SKU step needs a SKU; the verdict step needs a verdict and the stored shots", () => {
  const cfg = photoStationTemplate("grp3");
  const s = emptyRunState();
  assert.equal(stepBlocker(cfg.steps[0], s, CTX.station), TEMPLATE_RUN_TEXT.skuMissing);
  s.sku = " MK-1 ";
  assert.equal(stepBlocker(cfg.steps[0], s, CTX.station), null);

  const photo = cfg.steps[1].components[0] as PhotoComponent;
  assert.equal(stepBlocker(cfg.steps[1], s, CTX.station), TEMPLATE_RUN_TEXT.verdictMissing);
  s.verdict.ok = "pass";
  assert.equal(finishBlocker(cfg, s, CTX.station), null, "min 0: photos optional, as today");
  s.photos[photo.id] = [{ previewUrl: "a", uploading: true }];
  assert.equal(finishBlocker(cfg, s, CTX.station), TEMPLATE_RUN_TEXT.photoUploading);
  s.photos[photo.id] = [{ previewUrl: "a", failed: true }];
  assert.equal(finishBlocker(cfg, s, CTX.station), TEMPLATE_RUN_TEXT.photoFailed);

  photo.min = 2;
  s.photos[photo.id] = [{ previewUrl: "a", objectKey: "k1" }];
  assert.equal(finishBlocker(cfg, s, CTX.station), TEMPLATE_RUN_TEXT.photosMissing("תיעוד בתמונות", 2));
  s.photos[photo.id].push({ previewUrl: "b", objectKey: "k2" });
  assert.equal(finishBlocker(cfg, s, CTX.station), null);
  assert.equal(finishBlocker(cfg, s, CTX.station, true), TEMPLATE_RUN_TEXT.fieldsMissing, "the route's fields hold their step");
});

test("the route's fields: at their component, else before the verdict", () => {
  const cfg = verdictStationTemplate();
  assert.deepEqual(routeFieldsSlot(cfg), { stepIndex: 1, componentId: cfg.steps[1].components[1].id, atComponent: true });
  cfg.steps[1].components.splice(1, 1);
  assert.deepEqual(routeFieldsSlot(cfg), { stepIndex: 1, componentId: cfg.steps[1].components[1].id, atComponent: false });
  assert.equal(routeFieldsSlot({ steps: [], finish_label: "x" }), null);
});

test("the weight against the reference", () => {
  assert.deepEqual(weightOutcome(weightComp, 400, ""), { measured: null, diffPct: null, pass: null });
  assert.deepEqual(weightOutcome(weightComp, 400, "x"), { measured: null, diffPct: null, pass: null });
  assert.deepEqual(weightOutcome(weightComp, null, "410"), { measured: 410, diffPct: null, pass: null });
  assert.deepEqual(weightOutcome(weightComp, 400, "410"), { measured: 410, diffPct: 2.5, pass: true });
  assert.equal(weightOutcome(weightComp, 400, "440").pass, false);
  const cfg: PopupTemplateConfig = verdictStationTemplate();
  cfg.steps[1].components.unshift(weightComp);
  const s = emptyRunState("MK");
  s.verdict.ok = "fail";
  assert.equal(finishBlocker(cfg, s, CTX.station), TEMPLATE_RUN_TEXT.weightMissing);
  s.weights[weightComp.id] = "390";
  assert.equal(finishBlocker(cfg, s, CTX.station), null);
});

test("details keep today's keys: sku, hasRU, verdict — and add the components", () => {
  const cfg = photoStationTemplate("grp3");
  const photo = cfg.steps[1].components[0];
  const s = emptyRunState("MK-1");
  s.hasRU = true;
  s.photos[photo.id] = [{ previewUrl: "a", objectKey: "k1" }, { previewUrl: "b", uploading: true }];
  s.verdict = { ok: "pass", note: "הערה" };
  const d = buildTemplateDetails(cfg, CTX, s);
  assert.deepEqual(d, {
    station: "type-2",
    template: { v: 4 },
    sku: "MK-1",
    hasRU: true,
    components: {
      [cfg.steps[0].components[0].id]: { t: "scan", label: "מק״ט יצרן", value: "MK-1" },
      [photo.id]: { t: "photo", label: "תיעוד בתמונות", photo_type: "grp3", photos: ["k1"] },
    },
    verdict: { ok: "pass", note: "הערה" },
  });

  const v = verdictStationTemplate();
  v.steps[1].components.unshift(weightComp);
  const sv = emptyRunState("");
  sv.refWeight = 400;
  sv.weights[weightComp.id] = "420";
  const dv = buildTemplateDetails(v, CTX, sv);
  assert.equal(dv.sku, "", "a template with a SKU scan always saves the key");
  assert.deepEqual((dv.components as Record<string, unknown>)[weightComp.id], { t: "number", label: "משקל", value: 420, unit: "גר׳", in_range: true });
  assert.equal(Object.keys(dv.components as object).length, 1, "a blank SKU is left out of the components");
});
