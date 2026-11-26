// What the four box wizards share (boxWizard.ts, opening/openingModel.ts, closing/closingModel.ts),
// and the code's wizards against their template twins: the same work saves the same keys, the
// template adding only its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closingTemplate, openingTemplate } from "@/app/lib/popup-templates/templates";
import type { PackageItemView } from "@/app/lib/packages/contract";
import type { ResultBody } from "@/app/lib/testing/contract";
import { fieldsGateText } from "@/app/lib/station-fields/labels";
import { itemResultBody, postItemResults, type SentItems } from "../boxWizard";
import { buildClosingBoxDetails, buildOpeningBoxDetails, buildOpeningItemDetails, freshItemWork, itemOutcome } from "../packageTemplateModel";
import { emptyRunState } from "../templateModel";
import {
  freshWork, openingDoneRows, openingFinishHold, weightResult, wizardBoxDetails, wizardItemDetails, wizardItemPasses,
} from "../opening/openingModel";
import { closingDoneRows, closingFinishHold, closingItemDetails, decisionsOf, packedIds } from "../closing/closingModel";

const keySet = (o: object) => Object.keys(o).sort();
const item = (id: string, seq: number, over: Partial<PackageItemView> = {}): PackageItemView => ({
  item_id: id, package_seq: seq, item_type_id: 5, item_type_desc: "מחשב", serial_no: null, makat: null, model: null,
  manufacturer_name: null, manufacturer_no: null, current_status: 2, current_route_step: 1, route_length: 3, step_desc: null,
  is_finished: false, state: "waiting" as PackageItemView["state"], state_label: "", station_name: null, arrived_at_closing: false,
  prev_step_desc: null, prev_step_package_level: false, report_waits: null, pack_decision: null, pack_note: null, ...over,
});

// ---- the per-item results ----------------------------------------------------------------------

test("an item's result body: the item at this station, by this worker, under the box's submit id", () => {
  const ctx = { stationId: 12, workerId: 7, workerName: "דנה", submitId: "s-1" };
  assert.deepEqual(itemResultBody(ctx, item("1005", 1), { Result: 1, Passed: true, Details: { closing: true } }), {
    ItemID: 1005, StationID: 12, WorkerID: 7, WorkerName: "דנה", SubmitID: "s-1", Result: 1, Passed: true, Details: { closing: true },
  });
  const anonymous = itemResultBody({ ...ctx, workerId: null, workerName: "" }, item("1005", 1), { Result: 0 });
  assert.equal(anonymous.WorkerID, undefined);
  assert.equal(anonymous.WorkerName, undefined);
});

/** A fetch that answers each POST /api/testing/results in turn. */
function stubFetch(answers: (Response | Error)[]) {
  const sent: ResultBody[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const next = answers.shift();
    if (!next) throw new Error("no answer left");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bodyOf = (it: PackageItemView): ResultBody => ({ ItemID: Number(it.item_id), StationID: 1, Result: 1 });

test("the finish posts every item not sent yet, in order, and keeps where each goes next", async () => {
  const net = stubFetch([
    json(200, { ok: true, success: true, nextStation: { testStationId: 4, testStationDesc: "עמדה 4", stationTypeId: 2, routeStep: 2 } }),
    json(200, { ok: true, success: true, isLastStation: true }),
  ]);
  try {
    const sent: SentItems = { committed: new Set(["2"]), nextStops: new Map() };
    const answered: string[] = [];
    await postItemResults([item("1", 1), item("2", 2), item("3", 3)], sent, bodyOf, () => assert.fail("no reload"), (it) => answered.push(it.item_id));
    assert.deepEqual(net.sent.map((b) => b.ItemID), [1, 3], "an item an earlier try or opening sent is not sent again");
    assert.deepEqual([...sent.committed].sort(), ["1", "2", "3"]);
    assert.deepEqual(sent.nextStops.get("1"), { kind: "station", name: "עמדה 4" });
    assert.deepEqual(sent.nextStops.get("3"), { kind: "end" });
    assert.deepEqual(answered, ["1", "3"]);
  } finally { net.restore(); }
});

test("a refusal stops the finish with the item's line; a 409 FIELDS_SCHEMA_MISMATCH asks the fields again", async () => {
  const net = stubFetch([
    json(200, { ok: true, success: true }),
    json(409, { error: "הגדרות השדות השתנו", code: "FIELDS_SCHEMA_MISMATCH" }),
  ]);
  try {
    const sent: SentItems = { committed: new Set(), nextStops: new Map() };
    let reloads = 0;
    await assert.rejects(
      postItemResults([item("1", 1), item("2", 2, { serial_no: "SN-2" }), item("3", 3)], sent, bodyOf, () => { reloads++; }),
      { message: "שמירת הפריט SN-2 נכשלה — הגדרות השדות השתנו" },
    );
    assert.equal(reloads, 1);
    assert.deepEqual([...sent.committed], ["1"], "what was saved stays saved: a retry starts at the refused item");
  } finally { net.restore(); }

  const plain = stubFetch([new Response("<html>bad gateway</html>", { status: 502 })]);
  try {
    await assert.rejects(postItemResults([item("1", 7)], { committed: new Set(), nextStops: new Map() }, bodyOf, () => assert.fail("no reload")),
      { message: "שמירת הפריט 07 נכשלה (502)" }, "no error text: the status, and the item by its place in the box");
  } finally { plain.restore(); }

  const offline = stubFetch([new TypeError("fetch failed")]);
  try {
    await assert.rejects(postItemResults([item("1", 1)], { committed: new Set(), nextStops: new Map() }, bodyOf, () => {}),
      { name: "TypeError", message: "fetch failed" }, "a network failure goes up as it is");
  } finally { offline.restore(); }
});

// ---- the opening: the code's wizard and its template twin ---------------------------------------

test("the opening: the same item saves the same keys in both wizards, the template adding its version and components", () => {
  const cfg = openingTemplate("package", "product");
  const flow = cfg.item_flow!;
  const photoId = flow[1].components.find((c) => c.kind === "photo")!.id;
  const weightId = flow[2].components.find((c) => c.kind === "weight")!.id;
  const shot = { previewUrl: "blob:a", objectKey: "items/1/a.jpg" };

  const code = { ...freshWork(), sku: "MK-1", hasRU: true, refWeight: 400, refSource: "package" as const, expectedSku: "MK-1", meas: "404",
    photos: { ok: "pass" as const, note: "ok", photos: [shot] } };
  const tpl = { ...freshItemWork("MK-1"), sku: "MK-1", refSource: "package" as const, expectedSku: "MK-1",
    run: { ...emptyRunState("MK-1"), hasRU: true, refWeight: 400, verdict: { ok: "pass" as const, note: "ok" }, photos: { [photoId]: [shot] }, weights: { [weightId]: "404" } } };

  const a = wizardItemDetails(code, "77");
  const b = buildOpeningItemDetails(flow, { version: 3, station: "פתיחה", packageId: "77" }, tpl);
  assert.deepEqual(keySet(b), keySet({ ...a, template: 0, components: 0 }));
  for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], k);
  assert.equal(wizardItemPasses(code), itemOutcome(flow, tpl.run).pass);

  const facts = { packageReference: null, itemCount: 1, registeredCount: 1, templateCount: 1, labelsPrinted: true, packageItemIds: ["78"] };
  const box = wizardBoxDetails({ sku: " BOX-1 ", hasRU: false, photos: { ok: "fail", note: "קרוע", photos: [] } }, facts);
  const tplBox = buildOpeningBoxDetails(cfg, { version: 3, station: "פתיחה" }, { ...emptyRunState(" BOX-1 "), hasRU: false, verdict: { ok: "fail", note: "קרוע" } }, facts);
  assert.deepEqual(keySet(tplBox), keySet({ ...box, template: 0, components: 0 }));
  for (const k of Object.keys(box)) assert.deepEqual(tplBox[k], box[k], k);
});

test("the code wizard's weighing: 5% around the reference; a 0 reference compares (B9, unlike a template)", () => {
  assert.deepEqual(weightResult(400, "410"), { diff: 10, diffPct: 2.5, pass: true });
  assert.equal(weightResult(400, "500")?.pass, false);
  assert.equal(weightResult(null, "500"), null);
  assert.equal(weightResult(400, " "), null);
  assert.deepEqual(weightResult(0, "12"), { diff: 12, diffPct: 0, pass: true });
  assert.equal(wizardItemPasses({ ...freshWork(), refWeight: 400, meas: "500", photos: { ok: "pass", note: "", photos: [] } }), false);
});

test("the opening's finish waits for every shot and for the fields' answer and gate", () => {
  const gateBlocks = { ev: { missingRequired: ["f_a"], missingNotes: [] as string[] }, blocking: (gate: boolean) => gate };
  const open = { ev: { missingRequired: [] as string[], missingNotes: [] as string[] }, blocking: () => false };
  assert.equal(openingFinishHold([{ previewUrl: "b", uploading: true }], [], "ready", true), "יש צילום שעדיין עולה — המתן לסיום ההעלאה.");
  assert.equal(openingFinishHold([{ previewUrl: "b", failed: true }, { previewUrl: "c", uploading: true }], [], "ready", true), "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום.");
  assert.equal(openingFinishHold([], [], "loading", true), "wait");
  assert.equal(openingFinishHold([], [], "error", true), "טעינת הגדרות השדות נכשלה");
  assert.equal(openingFinishHold([], [], null, true), null, "no fields asked: nothing to wait for");
  assert.equal(openingFinishHold([], [{ fx: gateBlocks }, { fx: open }], "ready", true), fieldsGateText(1, 0));
  assert.equal(openingFinishHold([], [{ fx: gateBlocks }, { fx: open }], "ready", false), null);
});

test("the opening's done rows: the box waits at its closing; an item without an answer shows where it is", () => {
  const rows = openingDoneRows({ item_type_desc: "ערכה" }, [item("1", 1), item("2", 2, { station_name: "עמדה 9" }), item("3", 3)], { kind: "station", name: "סגירה" },
    new Map([["1", { kind: "end" as const }]]));
  assert.deepEqual(rows.map((r) => [r.badge, r.stop, r.note]), [
    ["00", { kind: "station", name: "סגירה" }, "ממתין לפריטי המארז"],
    ["01", { kind: "end" }, undefined],
    ["02", { kind: "station", name: "עמדה 9" }, undefined],
    ["03", { kind: "unknown" }, undefined],
  ]);
});

// ---- the closing: the code's wizard and its template twin ---------------------------------------

test("the closing: an arrived item's details in both wizards, the template adding its version", () => {
  const fields = { schema: { route_id: 1, v: 2, step_uid: "s_x", target: "kit_item" as const }, fields: {}, verdict: { suggested: null } };
  assert.deepEqual(closingItemDetails("77", null, null), { closing: true, packed: true, package_id: "77" });
  assert.deepEqual(closingItemDetails("77", 4, fields), { closing: true, packed: true, package_id: "77", template: { v: 4 }, ...fields });
});

test("the closing's packed items and decisions: fields only on a 'נארז בכל זאת', and only with a config", () => {
  const items = [item("1", 1, { arrived_at_closing: true }), item("2", 2, { arrived_at_closing: true }), item("3", 3), item("4", 4)];
  assert.deepEqual(packedIds(items, { 1: true, 3: true }), ["1"], "only an arrived item is packed");
  const decisions = { 3: { decision: "packed_anyway" as const, note: "הובא ידנית" }, 4: { decision: "missing" as const, note: "לא נמצא" } };
  assert.deepEqual(decisionsOf(items, decisions, null), [
    { item_id: "3", decision: "packed_anyway", note: "הובא ידנית" },
    { item_id: "4", decision: "missing", note: "לא נמצא" },
  ]);
  const withFields = decisionsOf(items, decisions, () => ({ fields: {}, suggested: "pass" }));
  assert.deepEqual(withFields[0], { item_id: "3", decision: "packed_anyway", note: "הובא ידנית", fields: {}, suggested: "pass" });
  assert.deepEqual(withFields[1], { item_id: "4", decision: "missing", note: "לא נמצא" }, "'חסר במארז' carries none");

  // The template's box details carry the same packed / decisions the code's wizard sends.
  const tpl = buildClosingBoxDetails(closingTemplate(), { version: 1, station: "" }, emptyRunState(), { packed: packedIds(items, { 1: true }), decisions: withFields });
  assert.deepEqual([tpl.packed, tpl.decisions], [["1"], withFields]);
});

test("the closing's finish holds on a missing field (gate on) or a shot not stored", () => {
  const missing = { ev: { missingRequired: ["f_a"], missingNotes: ["f_b"] }, photosPending: [] as string[], drafts: {} };
  const uploading = { ev: { missingRequired: [] as string[], missingNotes: [] as string[] }, photosPending: ["f_p"], drafts: { f_p: { photos: [{ previewUrl: "b", uploading: true }] } } };
  assert.equal(closingFinishHold([missing], [], true), fieldsGateText(1, 1));
  assert.equal(closingFinishHold([missing], [], false), null, "gate off: a missing field does not hold");
  assert.equal(closingFinishHold([uploading], [], false), "יש צילום שעדיין עולה — המתן לסיום ההעלאה.");
  assert.equal(closingFinishHold([], [{ previewUrl: "c", failed: true }], false), "יש צילום שההעלאה שלו נכשלה — הסר אותו וצלם שוב לפני הסיום.");
  assert.equal(closingFinishHold([], [], true), null);
});

test("the closing's done rows: the box, then only the items that answered", () => {
  const rows = closingDoneRows({ item_type_desc: "ערכה" }, [item("1", 1), item("2", 2)], { kind: "end" }, new Map([["2", { kind: "end" as const }]]));
  assert.deepEqual(rows.map((r) => [r.key, r.badge, r.stop.kind]), [["box", "00", "end"], ["2", "02", "end"]]);
});
