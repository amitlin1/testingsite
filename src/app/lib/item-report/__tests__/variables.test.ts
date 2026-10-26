import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalog, buildStepResults, buildValues, formatFieldValue, overallVerdict, rowStepUid,
} from "../variables";
import type { CatalogRoute, ResultRow } from "../variables";
import { requiresFinalSignature, collectLogoKeys } from "../template-utils";
import type { RouteFieldsConfig } from "@/app/lib/station-fields/schema";

const fmt = (iso: string) => ({ date: iso.slice(0, 10), time: iso.slice(11, 16) });

const ROUTE = { route_number: 1, route_steps: [10, 20, 30], step_uids: ["s_aaaaaaaa", "s_bbbbbbbb", "s_cccccccc"] };

function row(over: Partial<ResultRow>): ResultRow {
  return {
    test_result_id: 1, route_number: 1, route_step: 1, station: "עמדה 1", station_type: "קליטה",
    station_is_research: false, worker_id: 77, worker_name: "דנה לוי", passed: true, result: 1,
    comments: null, details: null, created_at: "2026-10-01T08:00:00.000Z", ...over,
  };
}

test("formatFieldValue: every saved field type prints text + tone", () => {
  assert.deepEqual(formatFieldValue({ t: "number", label: "מתח", value: 27.9, unit: "V", in_range: true }), { value: "27.9 V", tone: "pass" });
  assert.deepEqual(formatFieldValue({ t: "number", label: "מתח", value: null, in_range: null }), { value: "", tone: null });
  assert.deepEqual(formatFieldValue({ t: "choice_row", label: "נורית", opt: "o_x", opt_label: "מהבהבת", tone: "warn" }), { value: "מהבהבת", tone: "warn" });
  assert.deepEqual(formatFieldValue({ t: "pass_fail", label: "x", ok: "fail" }), { value: "לא תקין", tone: "fail" });
  assert.deepEqual(
    formatFieldValue({ t: "checklist", label: "x", items: [{ id: "c_1", label: "א", ok: true }, { id: "c_2", label: "ב", ok: false }] }),
    { value: "א ✓ · ב ✗", tone: "fail" },
  );
  assert.deepEqual(formatFieldValue({ t: "photo", label: "x", photo_type: "product", photos: ["items/1/a.jpg"] }), { value: "1 תמונות", tone: null, photos: ["items/1/a.jpg"] });
});

test("rowStepUid: the schema ref wins; else the item's route at the row's position", () => {
  assert.equal(rowStepUid(row({ details: { schema: { step_uid: "s_kit00001" } } }), ROUTE), "s_kit00001");
  assert.equal(rowStepUid(row({ route_step: 2 }), ROUTE), "s_bbbbbbbb");
  assert.equal(rowStepUid(row({ route_number: 2 }), ROUTE), null);
  assert.equal(rowStepUid(row({ route_step: 9 }), ROUTE), null);
});

test("buildStepResults: latest row per step, route order, research and foreign rows dropped", () => {
  const rows: ResultRow[] = [
    row({ test_result_id: 1, route_step: 2, passed: false, created_at: "2026-10-01T09:00:00.000Z" }),
    row({ test_result_id: 2, route_step: 2, passed: true, created_at: "2026-10-01T10:00:00.000Z", worker_name: null, worker_id: 5 }),
    row({ test_result_id: 3, route_step: 1 }),
    row({ test_result_id: 4, route_step: 3, station_is_research: true }),
    row({ test_result_id: 5, details: { schema: { step_uid: "s_other000" } } }),
    row({
      test_result_id: 6, route_step: 3,
      details: { schema: { step_uid: "s_kit00001" }, fields: { f_w0000001: { t: "number", label: "משקל", value: 2, unit: "kg", in_range: false, note: "כבד" } }, verdict: { ok: "fail", suggested: "fail" } },
      passed: null,
    }),
  ];
  const res = buildStepResults(rows, ROUTE, fmt, new Set(["s_kit00001"]));
  assert.deepEqual(res.map((r) => r.uid), ["s_aaaaaaaa", "s_bbbbbbbb", "s_kit00001"]);
  assert.equal(res[1]!.verdict, "pass");
  assert.equal(res[1]!.worker, "#5");
  assert.equal(res[2]!.verdict, "fail");
  assert.deepEqual(res[2]!.fields, [{ id: "f_w0000001", label: "משקל", value: "2 kg", tone: "fail", note: "כבד" }]);
  assert.equal(overallVerdict(res), "fail");
  const passed = res.filter((r) => r.verdict === "pass");
  assert.equal(overallVerdict(passed, true), "pass");
  assert.equal(overallVerdict(passed, false), null, "not תקין while the route is still running");
  assert.equal(overallVerdict(res, false), "fail", "a failed step shows at once");

  const values = buildValues({ item_id: "123", serial_no: "SN1" }, res, { generated_at: "01.10.2026" });
  assert.equal(values["item.item_id"], "123");
  assert.equal(values["item.verdict"], "לא תקין");
  assert.equal(values["report.generated_at"], "01.10.2026");
  assert.equal(values["step.s_aaaaaaaa.worker"], "דנה לוי");
  assert.equal(values["step.s_aaaaaaaa.date"], "2026-10-01");
  assert.equal(values["step.s_aaaaaaaa.result"], "1");
  assert.equal(values["field.s_kit00001.f_w0000001"], "2 kg");
  assert.equal(values["field.s_kit00001.f_w0000001.status"], "לא תקין");
  assert.equal(values["field.s_kit00001.f_w0000001.note"], "כבד");
});

test("buildStepResults: legacy popups' photos and weight become fields", () => {
  const res = buildStepResults(
    [row({ details: { photo: { ok: true, photos: ["items/1/p.jpg"] }, weight: { measured: 3, reference: 3.1, pass: true } } })],
    ROUTE, fmt,
  );
  assert.deepEqual(res[0]!.fields.map((f) => f.id), ["legacy_weight", "legacy_photos"]);
  assert.deepEqual(res[0]!.fields[1]!.photos, ["items/1/p.jpg"]);
});

test("buildStepResults: a popup template's components print before the route's fields, in popup order", () => {
  const details = {
    sku: "MK-1",
    components: [
      { id: "k_sku00001", t: "scan", label: "מק״ט יצרן", value: "MK-1" },
      { id: "k_photo001", t: "photo", label: "תיעוד בתמונות", photo_type: "k_photo001", photos: ["items/1/a.jpg", "items/1/b.jpg"] },
      { id: "k_weight01", t: "number", label: "משקל", value: 410, unit: "גר׳", in_range: false },
    ],
    fields: { f_v0000001: { t: "pass_fail", label: "בידוד", ok: "pass" } },
    verdict: { ok: "pass", note: "" },
  };
  const res = buildStepResults([row({ route_step: 2, details })], ROUTE, fmt, undefined, new Map([["s_bbbbbbbb", ["f_v0000001"]]]));
  assert.deepEqual(res[0]!.fields.map((f) => [f.id, f.value, f.tone]), [
    ["k_sku00001", "MK-1", null],
    ["k_photo001", "2 תמונות", null],
    ["k_weight01", "410 גר׳", "fail"],
    ["f_v0000001", "תקין", "pass"],
  ]);
  assert.equal(res[0]!.fields.filter((f) => f.photos).length, 1, "the template's photos are not repeated as legacy photos");
});

test("buildStepResults: an item opened against its package reference shows where its reference came from", () => {
  const at = (details: Record<string, unknown>) =>
    buildStepResults([row({ details })], ROUTE, fmt)[0]!.fields.find((f) => f.id === "legacy_reference");
  assert.deepEqual(at({ sku: "PC-1", refSource: "package", expectedSku: "PC-1" }), { id: "legacy_reference", label: "ייחוס", value: "מייחוס המארז", tone: "pass" });
  assert.deepEqual(at({ sku: "PC-9", refSource: "package_fallback", expectedSku: "PC-1" }), { id: "legacy_reference", label: "ייחוס", value: "מייחוס המארז · המק״ט לא תאם · צפוי PC-1", tone: "warn" });
  assert.deepEqual(at({ sku: "PC-6", refSource: "scan", expectedSku: "PC-1" }), { id: "legacy_reference", label: "ייחוס", value: "לפי הסריקה · צפוי PC-1", tone: "warn" });
  assert.deepEqual(at({ sku: "PC-6", refSource: "scan", expectedSku: null }), { id: "legacy_reference", label: "ייחוס", value: "לפי הסריקה", tone: null });
  assert.equal(at({ sku: "PC-6", hasRU: true }), undefined, "results saved before it show no such field");
});

test("buildCatalog: item steps + the kit's package-level steps with the item's groups", () => {
  const itemCfg: RouteFieldsConfig = {
    schema: 1,
    steps: {
      s_bbbbbbbb: {
        uid: "s_bbbbbbbb", station_type_id: 20, station_label: "חשמלית", scope: "item",
        groups: [{ target: "item", fields: [
          { id: "f_v0000001", type: "number", label: "מתח", required: true, notes: "optional", out_of_range_fail: true },
          { id: "f_p0000001", type: "photo", label: "צילום", required: false, notes: "off", photo_type: "product", min: 0 },
        ] }],
      },
    },
  };
  const kitCfg: RouteFieldsConfig = {
    schema: 1,
    steps: {
      s_kit00001: {
        uid: "s_kit00001", station_type_id: 99, station_label: "פתיחה", scope: "package",
        groups: [
          { target: "box", fields: [{ id: "f_box00001", type: "text", label: "קופסה", required: false, notes: "off" }] },
          { target: "each_item", fields: [{ id: "f_each0001", type: "text", label: "לכל פריט", required: false, notes: "off" }] },
          { target: { item_type_id: 7 }, fields: [{ id: "f_type0001", type: "text", label: "של הסוג", required: false, notes: "off" }] },
          { target: { item_type_id: 8 }, fields: [{ id: "f_type0002", type: "text", label: "סוג אחר", required: false, notes: "off" }] },
        ],
      },
    },
  };
  const routes: CatalogRoute[] = [
    { label: "מסלול 1", kind: "item", item_type_id: 7, config: itemCfg, ...ROUTE },
    { label: "מארז א · מסלול 1", kind: "kit", item_type_id: 7, config: kitCfg, route_steps: [99, 20], step_uids: ["s_kit00001", "s_kitnot01"] },
  ];
  const stations = { 10: { label: "קליטה", package_level: false }, 20: { label: "חשמלית", package_level: false }, 30: { label: "אריזה", package_level: false }, 99: { label: "פתיחת מארז", package_level: true } };
  const { vars, steps } = buildCatalog(routes, stations);
  assert.deepEqual(steps.map((s) => s.uid), ["s_aaaaaaaa", "s_bbbbbbbb", "s_cccccccc", "s_kit00001"]);
  assert.deepEqual(steps[3]!.fields.map((f) => f.id), ["f_each0001", "f_type0001"]);
  const names = new Set(vars.map((v) => v.name));
  assert.ok(names.has("item.serial_no"));
  assert.ok(names.has("step.s_aaaaaaaa.worker"));
  assert.ok(names.has("field.s_bbbbbbbb.f_v0000001"));
  assert.ok(names.has("field.s_bbbbbbbb.f_v0000001.note"));
  assert.ok(!names.has("field.s_bbbbbbbb.f_p0000001"), "photos are a block, not a text variable");
  assert.ok(!names.has("field.s_kit00001.f_box00001"), "the box group is not the item's");
  assert.ok(!names.has("field.s_kit00001.f_type0002"));
});

test("template-utils: final signature and logo keys", () => {
  const sig = (cells: unknown) => ({ root: { props: { header: { rightLogo: "logos/a.png", leftLogo: "/report-logos/x.png" } } }, content: [{ type: "Signature", props: { bind: "final", cells } }] });
  assert.equal(requiresFinalSignature(sig([{ kind: "signature" }])), true);
  assert.equal(requiresFinalSignature(sig([{ kind: "fullName" }])), false);
  assert.equal(requiresFinalSignature({ content: [] }), false);
  assert.deepEqual(collectLogoKeys(sig([])), ["logos/a.png"]);
});

test("officialStarterTemplate: known blocks only, every variable in the catalog, wants the final signature", async () => {
  const { officialStarterTemplate } = await import("../starter");
  const { puckConfig } = await import("../puck-config");
  const { ITEM_VARS, REPORT_VARS } = await import("../variables");
  const t = officialStarterTemplate();
  const known = new Set(Object.keys(puckConfig.components));
  for (const n of t.content) assert.ok(known.has(n.type), `unknown block ${n.type}`);
  const names = new Set([...ITEM_VARS.map((v) => `item.${v.key}`), ...REPORT_VARS.map((v) => `report.${v.key}`)]);
  const used = JSON.stringify(t).match(/"v":"([^"]+)"/g)!.map((m) => m.slice(5, -1));
  for (const v of used) assert.ok(names.has(v), `unknown variable ${v}`);
  assert.equal(requiresFinalSignature(t), true);
  assert.notStrictEqual(officialStarterTemplate().root, t.root, "a fresh copy every time");
});
