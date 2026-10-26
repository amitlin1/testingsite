import { test } from "node:test";
import assert from "node:assert/strict";
import { closingTemplate, openingTemplate } from "@/app/lib/popup-templates/templates";
import type { ChecklistComponent, PopupTemplateConfig, TemplateStep } from "@/app/lib/popup-templates/schema";
import { TEMPLATE_RUN_TEXT, emptyRunState, stepBlocker } from "../templateModel";
import {
  bandOf, boxPasses, buildClosingBoxDetails, buildOpeningBoxDetails, buildOpeningItemDetails, closingChecks, closingNote, closingPasses,
  closingStepKind, freshItemWork, hebrewList, itemOutcome, itemsLine, openingStepKind,
} from "../packageTemplateModel";

const same = (t: string) => t;
const open = (): PopupTemplateConfig => openingTemplate("package", "product");
const photoOf = (st: TemplateStep) => st.components.find((c) => c.kind === "photo")!;
const weightOf = (cfg: PopupTemplateConfig) => cfg.item_flow![2].components.find((c) => c.kind === "weight")!;

test("today's opening reads as the wizard: its system steps, its bands, its items line", () => {
  const cfg = open();
  assert.deepEqual(cfg.steps.map(openingStepKind), ["components", "components", "contents", "items", "labels"]);
  assert.equal(bandOf(cfg.steps[0], same), null, "the scan step has no message: the code words its band");
  assert.equal(bandOf(cfg.steps[1], same), "נא לצלם את הקופסה בדיוק לפי תמונות הייחוס.");
  assert.equal(bandOf(cfg.item_flow![2], same), "נא לשקול את הפריט ולהזין את המשקל שנמדד.");
  assert.equal(itemsLine(cfg.item_flow!, same), "כל פריט עובר סריקה, צילום ושקילה. אפשר לעבוד בכל סדר.");
  assert.equal(hebrewList(["סריקה"]), "סריקה");
  assert.equal(hebrewList([]), "");
  assert.equal(itemsLine([], same), "אפשר לעבוד בכל סדר.");
});

test("an item passes unless its verdict fails it or a measured weight is out of tolerance", () => {
  const cfg = open();
  const flow = cfg.item_flow!;
  const w = weightOf(cfg);
  const run = { ...emptyRunState("MK-1"), refWeight: 400 };
  assert.deepEqual(itemOutcome(flow, run), { weight: null, pass: true }, "nothing measured: no weight, nothing failed");
  assert.deepEqual(itemOutcome(flow, { ...run, weights: { [w.id]: "410" } }), { weight: { reference: 400, measured: 410, diffPct: 2.5, pass: true }, pass: true });
  assert.equal(itemOutcome(flow, { ...run, weights: { [w.id]: "500" } }).pass, false, "25% off a ±5% tolerance");
  assert.equal(itemOutcome(flow, { ...run, verdict: { ok: "fail", note: "" } }).pass, false);
  assert.deepEqual(itemOutcome(flow, { ...run, refWeight: null, weights: { [w.id]: "500" } }), { weight: null, pass: true }, "no reference: weighed, not compared");
});

test("the box passes on its verdict; without one nothing fails it", () => {
  const cfg = open();
  assert.equal(boxPasses(cfg, { ...emptyRunState(), verdict: { ok: "pass", note: "" } }), true);
  assert.equal(boxPasses(cfg, { ...emptyRunState(), verdict: { ok: "fail", note: "" } }), false);
  const noVerdict: PopupTemplateConfig = { ...cfg, steps: cfg.steps.map((s) => ({ ...s, components: s.components.filter((c) => c.kind !== "verdict") })) };
  assert.equal(boxPasses(noVerdict, emptyRunState()), true);
});

test("the results keep the wizard's keys, and add the template's version and components", () => {
  const cfg = open();
  const flow = cfg.item_flow!;
  const shot = (key: string) => ({ previewUrl: `blob:${key}`, objectKey: key });

  const w = freshItemWork("MK-1");
  w.sku = "MK-1"; w.refSource = "package"; w.expectedSku = "MK-1";
  w.run = { ...w.run, hasRU: true, refWeight: 400, verdict: { ok: "pass", note: "ok" },
    photos: { [photoOf(flow[1]).id]: [shot("items/1/a.jpg"), { previewUrl: "blob:x", uploading: true }] }, weights: { [weightOf(cfg).id]: "404" } };
  const item = buildOpeningItemDetails(flow, { version: 3, station: "פתיחה", packageId: "77" }, w);
  assert.deepEqual(Object.keys(item), ["sku", "hasRU", "expectedSku", "refSource", "weight", "product", "package_id", "opening", "template", "components"]);
  assert.deepEqual(item.product, { ok: "pass", note: "ok", photos: ["items/1/a.jpg"] }, "only stored shots");
  assert.deepEqual(item.weight, { reference: 400, measured: 404, diffPct: 1, pass: true });
  assert.deepEqual([item.package_id, item.opening, item.template], ["77", true, { v: 3 }]);
  assert.deepEqual((item.components as { t: string }[]).map((c) => c.t), ["scan", "photo", "number"]);

  const box = { ...emptyRunState("BOX-1"), hasRU: false, verdict: { ok: "fail" as const, note: "קרוע" },
    photos: { [photoOf(cfg.steps[1]).id]: [shot("box/1.jpg")] } };
  const details = buildOpeningBoxDetails(cfg, { version: 3, station: "פתיחה" }, box, {
    packageReference: null, itemCount: 2, registeredCount: 2, templateCount: 2, labelsPrinted: true, packageItemIds: ["78", "79"],
  });
  assert.deepEqual(Object.keys(details), [
    "sku", "hasRU", "packageReference", "pkg", "itemCount", "registeredCount", "templateCount", "labelsPrinted", "packageItemIds", "opening", "template", "components",
  ]);
  assert.deepEqual(details.pkg, { ok: "fail", note: "קרוע", photos: ["box/1.jpg"] });
  assert.deepEqual([details.sku, details.hasRU, details.opening], ["BOX-1", false, true]);
});

test("a checklist holds its step until every row is ticked, and saves every row", () => {
  const list: ChecklistComponent = { id: "k_checks01", kind: "checklist", title: "בדיקות", items: [{ id: "i_aaaaaaaa", label: "א" }, { id: "i_bbbbbbbb", label: "ב" }] };
  const step: TemplateStep = { id: "p_checks01", title: "בדיקות", desc: "", components: [list, { id: "k_notes001", kind: "notes", label: "הערות אריזה" }] };
  const run = { ...emptyRunState(), checks: { [list.id]: ["i_aaaaaaaa"] } };
  assert.equal(stepBlocker(step, run, ""), TEMPLATE_RUN_TEXT.checksMissing("בדיקות"));
  const ticked = { ...run, checks: { [list.id]: ["i_aaaaaaaa", "i_bbbbbbbb"] }, notes: { k_notes001: " סגור " } };
  assert.equal(stepBlocker(step, ticked, ""), null);

  const cfg: PopupTemplateConfig = { role: "opening", steps: [step], finish_label: "x" };
  const details = buildOpeningBoxDetails(cfg, { version: 1, station: "" }, run, {
    packageReference: null, itemCount: 0, registeredCount: 0, templateCount: 0, labelsPrinted: false, packageItemIds: [],
  });
  assert.deepEqual(details.components, [
    { id: list.id, t: "checklist", label: "בדיקות", items: [{ id: "i_aaaaaaaa", label: "א", ok: true }, { id: "i_bbbbbbbb", label: "ב", ok: false }] },
  ], "a blank note is left out");
});

test("today's closing: its checks and note keep the wizard's keys; a missing item fails the box", () => {
  const cfg = closingTemplate();
  assert.deepEqual(cfg.steps.map(closingStepKind), ["components", "arrival", "components"]);
  const list = cfg.steps[2].components.find((c) => c.kind === "checklist") as ChecklistComponent;
  const notes = cfg.steps[2].components.find((c) => c.kind === "notes")!;
  const box = { ...emptyRunState(" BOX-9 "), hasRU: true, checks: { [list.id]: [list.items[0].id, list.items[2].id] }, notes: { [notes.id]: "סגור" } };
  assert.deepEqual(closingChecks(cfg, box), [
    { label: "כל הפריטים שסומנו נמצאים בקופסה", ok: true }, { label: "האריזה סגורה ותקינה", ok: false }, { label: "מדבקת המארז קריאה", ok: true },
  ]);
  assert.equal(closingNote(cfg, box), "סגור");
  const details = buildClosingBoxDetails(cfg, { version: 2, station: "סגירה" }, box, { packed: ["11"], decisions: [{ item_id: "12", decision: "missing", note: "x" }] });
  assert.deepEqual(Object.keys(details), ["sku", "hasRU", "closing", "checks", "note", "packed", "decisions", "template", "components"], "no verdict key: the template asks none");
  assert.deepEqual([details.sku, details.closing, details.packed, details.template], ["BOX-9", true, ["11"], { v: 2 }]);
  assert.equal(closingPasses(cfg, box, false), true);
  assert.equal(closingPasses(cfg, box, true), false);

  const withVerdict: PopupTemplateConfig = { ...cfg, steps: [...cfg.steps.slice(0, 2), { ...cfg.steps[2], components: [...cfg.steps[2].components, { id: "k_verdict9", kind: "verdict", question: "האריזה תקינה?", note_max: 1000 }] }] };
  const failed = { ...box, verdict: { ok: "fail" as const, note: "קרוע" } };
  assert.equal(closingPasses(withVerdict, failed, false), false, "a verdict the template asks can fail the box");
  assert.deepEqual(buildClosingBoxDetails(withVerdict, { version: 1, station: "" }, failed, { packed: [], decisions: [] }).verdict, { ok: "fail", note: "קרוע" });
});
