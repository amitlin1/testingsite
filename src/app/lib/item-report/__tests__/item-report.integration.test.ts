// Item PDF reports (docs/ITEM_REPORTS.md) end to end, through the real handlers: an item runs
// its route with station fields (/api/testing/start-test + /results), the report freezes when
// the route finishes, the signature locks it, reopening makes it a draft again — and every
// /api/item-reports handler as Next runs it (withAuth included).
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database (the write-path harness, as
// the station-fields suite) AND PUPPETEER_EXECUTABLE_PATH points at a Chrome/Chromium; without
// them the describe block is skipped. MinIO is an in-process S3 stand-in (below), so the suite
// needs no object store.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { AppRole } from "@/lib/auth/roles";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { Field, RouteFieldsConfig, StepConfig } from "../../station-fields/schema";

const CHROMIUM = process.env.PUPPETEER_EXECUTABLE_PATH ?? "";
const SKIP = !H.TEST_DATABASE_URL
  ? "TEST_DATABASE_URL is not set — item-report integration suite skipped"
  : !CHROMIUM
    ? "PUPPETEER_EXECUTABLE_PATH is not set — item-report integration suite skipped"
    : false;

// ---------------------------------------------------------------------------
// An in-memory S3: just the calls the minio client makes (bucket exists / make / versioning,
// put / get / stat / remove object). No auth checks.
// ---------------------------------------------------------------------------
const objects = new Map<string, { body: Buffer; type: string }>();
const buckets = new Set<string>();
function startFakeS3(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://s3");
    const [, bucket = "", ...rest] = u.pathname.split("/");
    const key = decodeURIComponent(rest.join("/"));
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (u.searchParams.has("location")) {
        res.setHeader("Content-Type", "application/xml");
        res.end('<?xml version="1.0"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>');
        return;
      }
      if (u.searchParams.has("versioning")) return void res.end();
      if (!key) {
        if (req.method === "PUT") buckets.add(bucket);
        else res.statusCode = buckets.has(bucket) ? 200 : 404;
        return void res.end();
      }
      const id = `${bucket}/${key}`;
      if (req.method === "PUT") {
        objects.set(id, { body: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "") });
        res.setHeader("ETag", '"e"');
        return void res.end();
      }
      if (req.method === "DELETE") {
        objects.delete(id);
        res.statusCode = 204;
        return void res.end();
      }
      const o = objects.get(id);
      if (!o) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/xml");
        return void res.end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>no</Message></Error>');
      }
      res.setHeader("Content-Type", o.type);
      res.setHeader("Content-Length", o.body.length);
      res.setHeader("ETag", '"e"');
      res.setHeader("Last-Modified", new Date().toUTCString());
      res.end(req.method === "HEAD" ? undefined : o.body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const stored = (key: string) => objects.get(`digitalfactory-files/${key}`)?.body;

// ---------------------------------------------------------------------------
// The session withAuth sees (as fields.integration.test.ts stubs it).
// ---------------------------------------------------------------------------
let session: unknown = null;
const signedIn = (...roles: AppRole[]) => ({
  user: { preferredUsername: "report-http", displayName: "רונית כהן", name: "report-http", employeeNumber: "9001" },
  roles,
});
function stubAuth(): void {
  const req = createRequire(path.resolve(process.cwd(), "package.json"));
  const authPath = req.resolve("./auth.ts");
  const CjsModule = req("node:module") as any;
  const stub = new CjsModule(authPath, null);
  stub.filename = authPath;
  stub.loaded = true;
  stub.exports = { auth: async () => session, handlers: {}, signIn: () => {}, signOut: () => {} };
  req.cache[authPath] = stub;
}

// ---------------------------------------------------------------------------
// Fixture: a plain item type whose route is [FUNC, FUNC] with fields at both steps; the kit
// world of the write-path fixture (PACKAGE_CLOSE = [INTAKE, CLOSE], IN_BOX = [INTAKE, FUNC, CLOSE])
// for the kit-step tests.
// ---------------------------------------------------------------------------
const ITEM_TYPE_REPORT = 21;
const UID = { a: "s_rep00001", b: "s_rep00002", kOpen: "s_kopen001", kClose: "s_kclose01", bOpen: "s_bopen001", bFunc: "s_bfunc001", bClose: "s_bclose01" };
const R = { report: 0, kit: 0, inBox: 0 };

const VOLT: Field = { id: "f_volt0001", type: "number", label: "מתח כניסה", required: true, notes: "optional", unit: "V", min: 26, max: 30, out_of_range_fail: true };
const LED: Field = {
  id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "optional",
  options: [{ id: "o_led00001", label: "תקין", tone: "pass" }, { id: "o_led00002", label: "מהבהבת", tone: "warn" }],
};
const CASE: Field = { id: "f_case0001", type: "pass_fail", label: "שלמות מארז", required: true, notes: "optional" };
const SEAL: Field = { id: "f_seal0001", type: "text", label: "מספר חותם", required: false, notes: "off" };

const itemStep = (uid: string, fields: Field[]): StepConfig =>
  ({ uid, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item", groups: [{ target: "item", fields }] });
const config = (...steps: StepConfig[]): RouteFieldsConfig => ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });

/** Text blocks bound to the variables the tests read back out of the HTML. */
function template(opts: { signature: boolean; marker?: string }) {
  return {
    root: { props: { header: { show: true, org: "ORG", meta: "", title: "דוח בדיקה", subtitle: "", rightLogo: "", leftLogo: "" }, footer: { show: true, text: "", textAlign: "center", pageNumbers: true, pageNumberStyle: "of", pageNumberAlign: "center" }, border: "none", font: "david", classification: "בלמ\"ס" } },
    content: [
      { type: "Text", props: { id: "t1", align: "right", width: "full", content: [
        { text: `${opts.marker ?? "MARK"} serial=` }, { v: "item.serial_no" },
        { text: " volt=" }, { v: `field.${UID.a}.${VOLT.id}` },
        { text: " led=" }, { v: `field.${UID.a}.${LED.id}` },
        { text: " ledstatus=" }, { v: `field.${UID.a}.${LED.id}.status` },
        { text: " case=" }, { v: `field.${UID.b}.${CASE.id}` },
        { text: " worker=" }, { v: `step.${UID.a}.worker` },
        { text: " verdict=" }, { v: "item.verdict" },
      ] } },
      { type: "ResultsTable", props: { id: "rt", showFields: true, showStation: true, showWorker: true, showDate: true, showComments: true, width: "full" } },
      ...(opts.signature
        ? [{ type: "Signature", props: { id: "sg", bind: "final", width: "full", cells: [{ kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } }]
        : []),
    ],
    zones: {},
  };
}

/** 1x1 transparent PNG. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("item PDF reports — template, draft, freeze at finish, signature, reopen, handlers", { skip: SKIP }, () => {
  let s3: http.Server;
  let A: typeof import("../../station-fields/admin");
  let G: typeof import("../generate");
  let api: {
    report: typeof import("../../../api/item-reports/[itemId]/route");
    status: typeof import("../../../api/item-reports/[itemId]/status/route");
    sign: typeof import("../../../api/item-reports/[itemId]/sign/route");
    template: typeof import("../../../api/item-reports/templates/[routeId]/route");
    preview: typeof import("../../../api/item-reports/templates/[routeId]/preview/route");
    logo: typeof import("../../../api/item-reports/logo/route");
  };

  before(async () => {
    s3 = await startFakeS3();
    // lib/minio.ts reads these when it is first imported — before H.setup() imports any route.
    process.env.MINIO_ENDPOINT = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
    process.env.MINIO_ROOT_USER = "suite";
    process.env.MINIO_ROOT_PASSWORD = "suite-secret";
    process.env.MINIO_VERSIONING = "false";
    stubAuth();
    await H.setup();
    A = await import("../../station-fields/admin");
    G = await import("../generate");
    api = {
      report: await import("../../../api/item-reports/[itemId]/route"),
      status: await import("../../../api/item-reports/[itemId]/status/route"),
      sign: await import("../../../api/item-reports/[itemId]/sign/route"),
      template: await import("../../../api/item-reports/templates/[routeId]/route"),
      preview: await import("../../../api/item-reports/templates/[routeId]/preview/route"),
      logo: await import("../../../api/item-reports/logo/route"),
    };
  });
  after(async () => {
    await H.teardown();
    const { closeBrowser } = await import("../render");
    await closeBrowser();
    await new Promise((r) => s3.close(r));
  });
  beforeEach(async () => {
    session = null;
    await H.resetDb();
    await H.q("TRUNCATE item_reports");
    await H.q("DELETE FROM file_objects WHERE entity_type LIKE 'item_report%' OR entity_type = 'report_logo'");
    await H.q(`INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'REPORT', false)`, [ITEM_TYPE_REPORT]);
    R.report = (await H.one<{ id: number }>(
      `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number, step_uids)
       VALUES ($1, $2, ARRAY[$2::int, $2::int], 1, $3::text[]) RETURNING test_route_id AS id`,
      [ITEM_TYPE_REPORT, H.TYPE_FUNC, [UID.a, UID.b]],
    )).id;
    R.kit = (await H.one<{ id: number }>(`UPDATE testing_routes SET step_uids = $2::text[] WHERE item_type_id = $1 RETURNING test_route_id AS id`, [H.ITEM_TYPE_PACKAGE_CLOSE, [UID.kOpen, UID.kClose]])).id;
    R.inBox = (await H.one<{ id: number }>(`UPDATE testing_routes SET step_uids = $2::text[] WHERE item_type_id = $1 RETURNING test_route_id AS id`, [H.ITEM_TYPE_IN_BOX, [UID.bOpen, UID.bFunc, UID.bClose]])).id;
  });

  // -------------------------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------------------------
  const ACTOR = { username: "report-suite", name: "Report Suite" };
  async function publish(routeId: number, cfg: RouteFieldsConfig): Promise<number> {
    const { draft_rev } = await H.one<{ draft_rev: number }>("SELECT draft_rev FROM testing_routes WHERE test_route_id = $1", [routeId]);
    const saved = await A.saveFieldsDraft(H.h().prisma as any, routeId, { config: cfg, base_rev: draft_rev }, ACTOR);
    const res = await A.publishFields(H.h().prisma as any, { route_ids: [routeId], base_revs: { [routeId]: saved.draft_rev }, apply_mode: "new_only" }, ACTOR);
    return res.versions[routeId];
  }

  async function call(handler: (req: any, ctx?: any) => Promise<Response>, url: string, init: RequestInit = {}, params?: Record<string, string>) {
    const res = await handler(new Request(`http://localhost${url}`, init) as any, params ? { params: Promise.resolve(params) } : undefined);
    const type = res.headers.get("content-type") ?? "";
    const body = type.includes("json") ? await res.json() : type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, headers: res.headers, body: body as any };
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function saveTemplate(routeId: number, t: unknown) {
    session = signedIn("manager");
    const r = await call(api.template.PUT, `/api/item-reports/templates/${routeId}`, json("PUT", { template: t }), { routeId: String(routeId) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }

  /** A REPORT item at step 1, frozen at the published fields version. */
  async function seedReportItem(itemId: number, version: number): Promise<void> {
    await H.seedItem({ itemId, itemTypeId: ITEM_TYPE_REPORT, stationId: H.STATION_FUNC_A });
    await H.q("UPDATE item_routes SET fields_version = $2 WHERE item_id = $1", [itemId, version]);
  }

  const schemaOf = (uid: string, v: number) => ({ route_id: R.report, v, step_uid: uid, target: "item" });
  async function runStep(itemId: number, uid: string, v: number, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const started = await H.startTest({ itemId, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const r = await H.submitResult({ ItemID: itemId, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true, Details: { schema: schemaOf(uid, v), fields }, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  /** Both steps, passing. */
  async function finishRoute(itemId: number, v: number) {
    await runStep(itemId, UID.a, v, { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00002", note: "בהפעלה קרה" } }, { Comments: "חוזר מתיקון" });
    await runStep(itemId, UID.b, v, { [CASE.id]: { t: "pass_fail", ok: "pass" } });
    assert.ok((await H.routeRow(itemId)).finished_at, "the route finished");
  }
  async function reportRow(itemId: number) {
    return (await H.q("SELECT * FROM item_reports WHERE item_id = $1", [itemId]))[0] ?? null;
  }
  /** The freeze runs after the response (detached here — outside a request after() throws). */
  async function waitForFrozen(itemId: number, version = 1) {
    for (let i = 0; i < 150; i++) {
      const row = await reportRow(itemId);
      if (row?.storage_key && row.version >= version) return row;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`item ${itemId}: no frozen report after 15s`);
  }
  async function getPdf(itemId: number) {
    session = signedIn("storekeeper");
    return call(api.report.GET, `/api/item-reports/${itemId}`, {}, { itemId: String(itemId) });
  }
  async function getHtml(itemId: number) {
    session = signedIn("storekeeper");
    return call(api.report.GET, `/api/item-reports/${itemId}?html=1`, {}, { itemId: String(itemId) });
  }
  async function status(itemId: number) {
    session = signedIn("tester");
    return (await call(api.status.GET, `/api/item-reports/${itemId}/status`, {}, { itemId: String(itemId) })).body;
  }
  async function sign(itemId: number, roles: AppRole[] = ["tester"]) {
    session = signedIn(...roles);
    return call(api.sign.POST, `/api/item-reports/${itemId}/sign`, json("POST", { signature: PNG }), { itemId: String(itemId) });
  }

  // -------------------------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------------------------

  it("the route's catalog: its steps, their fields, the item and report variables", async () => {
    await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    session = signedIn("storekeeper");
    const r = await call(api.template.GET, `/api/item-reports/templates/${R.report}`, {}, { routeId: String(R.report) });
    assert.equal(r.status, 200);
    assert.equal(r.body.template, null);
    assert.deepEqual(r.body.steps.map((s: any) => s.uid), [UID.a, UID.b]);
    assert.deepEqual(r.body.steps[0].fields.map((f: any) => f.id), [VOLT.id, LED.id]);
    const names = new Set(r.body.vars.map((v: any) => v.name));
    for (const n of ["item.serial_no", "report.generated_at", `step.${UID.a}.worker`, `field.${UID.a}.${VOLT.id}`, `field.${UID.b}.${CASE.id}.status`]) {
      assert.ok(names.has(n), n);
    }
  });

  it("a kit item's route also offers the kit's package-level steps (each_item + its own type), not the box's", async () => {
    const each: Field = { id: "f_each0001", type: "text", label: "לכל פריט", required: false, notes: "off" };
    const own: Field = { id: "f_own00001", type: "text", label: "של הסוג", required: false, notes: "off" };
    const box: Field = { id: "f_box00001", type: "text", label: "קופסה", required: false, notes: "off" };
    await publish(R.kit, config({
      uid: UID.kOpen, station_type_id: H.TYPE_INTAKE, station_label: "INTAKE", scope: "package",
      groups: [{ target: "box", fields: [box] }, { target: "each_item", fields: [each] }, { target: { item_type_id: H.ITEM_TYPE_IN_BOX }, fields: [own] }],
    }));
    await H.q("INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number) VALUES ($1, $2, 1, 1)", [H.ITEM_TYPE_PACKAGE_CLOSE, H.ITEM_TYPE_IN_BOX]);
    session = signedIn("storekeeper");
    const r = await call(api.template.GET, `/api/item-reports/templates/${R.inBox}`, {}, { routeId: String(R.inBox) });
    assert.equal(r.status, 200);
    const kitStep = r.body.steps.find((s: any) => s.uid === UID.kOpen);
    assert.ok(kitStep, "the kit's opening step is offered");
    assert.deepEqual(kitStep.fields.map((f: any) => f.id), [each.id, own.id]);
    assert.ok(!r.body.steps.some((s: any) => s.uid === UID.kClose && s.fields.length > 0));
  });

  it("template writes: roles, shape, size; DELETE removes it", async () => {
    session = signedIn("storekeeper");
    let r = await call(api.template.PUT, `/api/item-reports/templates/${R.report}`, json("PUT", { template: template({ signature: false }) }), { routeId: String(R.report) });
    assert.equal(r.status, 403);
    session = null;
    r = await call(api.template.PUT, `/api/item-reports/templates/${R.report}`, json("PUT", { template: template({ signature: false }) }), { routeId: String(R.report) });
    assert.equal(r.status, 401);
    session = signedIn("tester");
    r = await call(api.template.PUT, `/api/item-reports/templates/${R.report}`, json("PUT", { template: { nope: 1 } }), { routeId: String(R.report) });
    assert.equal(r.status, 400);
    r = await call(api.template.PUT, `/api/item-reports/templates/${R.report}`, json("PUT", { template: { content: [{ type: "Text", props: { content: "x".repeat(1100 * 1024) } }] } }), { routeId: String(R.report) });
    assert.equal(r.status, 413);
    r = await call(api.template.PUT, `/api/item-reports/templates/999999`, json("PUT", { template: template({ signature: false }) }), { routeId: "999999" });
    assert.equal(r.status, 404);
    r = await call(api.template.PUT, `/api/item-reports/templates/abc`, json("PUT", { template: template({ signature: false }) }), { routeId: "abc" });
    assert.equal(r.status, 400);
    r = await call(api.template.PUT, `/api/item-reports/templates/${R.report}`, json("PUT", { template: template({ signature: false }) }), { routeId: String(R.report) });
    assert.equal(r.status, 200);
    assert.equal(r.body.updated_by_name, "רונית כהן");
    r = await call(api.template.DELETE, `/api/item-reports/templates/${R.report}`, { method: "DELETE" }, { routeId: String(R.report) });
    assert.equal(r.status, 204);
    assert.equal((await H.q("SELECT 1 FROM report_templates")).length, 0);
  });

  it("no template → 204 and state no_template; unknown item → 404; malformed id → 400", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await seedReportItem(8001, v);
    assert.equal((await getPdf(8001)).status, 204);
    assert.equal((await status(8001)).state, "no_template");
    assert.equal((await getPdf(8999)).status, 404);
    session = signedIn("tester");
    assert.equal((await call(api.report.GET, "/api/item-reports/12x", {}, { itemId: "12x" })).status, 400);
    assert.equal((await call(api.report.GET, "/api/item-reports/1", {}, { itemId: "1" })).status, 404);
    session = null;
    assert.equal((await call(api.report.GET, "/api/item-reports/8001", {}, { itemId: "8001" })).status, 401);
  });

  it("in route: a live draft, never stored; the values come from the worker's fields", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8002, v);
    assert.equal((await status(8002)).state, "in_progress");
    await runStep(8002, UID.a, v, { [VOLT.id]: { t: "number", value: 31.5 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } });
    const pdf = await getPdf(8002);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("x-report-final"), "0");
    assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
    const html = (await getHtml(8002)).body as string;
    assert.match(html, /serial=.*SN-8002/);
    assert.match(html, /volt=.*31\.5 V/, "out of range, printed as the worker entered it");
    assert.match(html, /led=.*תקין/);
    assert.match(html, new RegExp(`worker=.*${H.WORKER_NAME}`), "the name from the ledger event");
    assert.match(html, /verdict=<span class="pdf-fill"><\/span>/, "no overall verdict while a step is still open");
    assert.match(html, /class="pdf-draftmark"/);
    assert.equal(await reportRow(8002), null, "drafts are never stored");
  });

  it("the route finishes → the report freezes by itself, is registered, and is served byte-for-byte", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8003, v);
    await finishRoute(8003, v);
    const row = await waitForFrozen(8003);
    assert.equal(row.storage_key, "reports/items/8003/v1.pdf");
    const blob = stored(row.storage_key);
    assert.ok(blob && blob.subarray(0, 5).toString() === "%PDF-");
    const registered = await H.q("SELECT entity_type, entity_id FROM file_objects WHERE object_key = $1", [row.storage_key]);
    assert.deepEqual(registered, [{ entity_type: "item_report", entity_id: "8003" }]);

    const first = await getPdf(8003);
    assert.equal(first.headers.get("x-report-final"), "1");
    assert.ok(Buffer.compare(first.body, blob!) === 0, "the stored copy, not a re-render");

    // Editing the template never touches a final report.
    await saveTemplate(R.report, template({ signature: false, marker: "CHANGED" }));
    const again = await getPdf(8003);
    assert.ok(Buffer.compare(again.body, blob!) === 0);
    assert.equal((await reportRow(8003)).version, 1);
    const st = await status(8003);
    assert.equal(st.state, "final");
    assert.equal(st.version, 1);

    // The final HTML carries the values as they finished.
    const html = (await getHtml(8003)).body as string;
    assert.match(html, /led=.*מהבהבת/);
    assert.match(html, /ledstatus=.*אזהרה/);
    assert.match(html, /case=.*תקין/);
    assert.match(html, /verdict=.*תקין/);
    assert.match(html, /חוזר מתיקון/, "the step's comment in the results table");
    assert.doesNotMatch(html, /class="pdf-draftmark"/);
  });

  it("a final report stays final when the template later gains a signature block, or is deleted", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8014, v);
    await finishRoute(8014, v);
    const row = await waitForFrozen(8014);
    const blob = stored(row.storage_key)!;

    await saveTemplate(R.report, template({ signature: true }));
    let st = await status(8014);
    assert.equal(st.state, "final", "not 'awaiting_signature' — it was final before the block existed");
    let pdf = await getPdf(8014);
    assert.equal(pdf.headers.get("x-report-final"), "1");
    assert.ok(Buffer.compare(pdf.body, blob) === 0);
    const signed = await sign(8014);
    assert.equal(signed.status, 409);
    assert.equal(signed.body.code, "ALREADY_FINAL");

    session = signedIn("manager");
    await call(api.template.DELETE, `/api/item-reports/templates/${R.report}`, { method: "DELETE" }, { routeId: String(R.report) });
    st = await status(8014);
    assert.equal(st.state, "final");
    pdf = await getPdf(8014);
    assert.equal(pdf.status, 200, "the locked report is still served after its template is deleted");
    assert.ok(Buffer.compare(pdf.body, blob) === 0);

    // …and with the blob lost too there is nothing to rebuild from: no report, no crash.
    objects.delete(`digitalfactory-files/${row.storage_key}`);
    assert.equal((await getPdf(8014)).status, 204);
  });

  it("a lost blob is rebuilt once on download instead of a 404", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8004, v);
    await finishRoute(8004, v);
    const row = await waitForFrozen(8004);
    objects.delete(`digitalfactory-files/${row.storage_key}`);
    const r = await getPdf(8004);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-report-final"), "1");
    assert.equal(r.headers.get("x-report-version"), "2");
    assert.ok(stored("reports/items/8004/v2.pdf"));
  });

  it("a signature block: finished → awaiting the signature; only the signer roles, once, then frozen with it", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true }));
    await seedReportItem(8005, v);

    let r = await sign(8005);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "NOT_FINISHED");

    await finishRoute(8005, v);
    await new Promise((res) => setTimeout(res, 1500)); // the detached freeze has nothing to do
    assert.equal(await reportRow(8005), null, "no final copy before the signature");
    let st = await status(8005);
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.canSign, true);
    const draft = await getPdf(8005);
    assert.equal(draft.headers.get("x-report-final"), "0");
    assert.match((await getHtml(8005)).body, /חתום\/י כאן/);

    assert.equal((await sign(8005, ["storekeeper"])).status, 403);
    session = signedIn("tester");
    r = await call(api.sign.POST, "/api/item-reports/8005/sign", json("POST", { signature: "data:image/jpeg;base64,AAAA" }), { itemId: "8005" });
    assert.equal(r.status, 400, "PNG only");

    r = await sign(8005);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 1);
    const row = await reportRow(8005);
    assert.equal(row.signed_by_name, "רונית כהן");
    assert.equal(row.signed_by_number, "9001");
    assert.ok(stored(row.signature_key));
    st = await status(8005);
    assert.equal(st.state, "final");
    assert.equal(st.signedBy, "רונית כהן");
    const html = (await getHtml(8005)).body as string;
    assert.match(html, /רונית כהן/);
    assert.match(html, /<img src="data:image\/png;base64,/, "the drawn signature, inlined");
    assert.doesNotMatch(html, /class="pdf-draftmark"/);

    r = await sign(8005);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_SIGNED");
  });

  it("a template without a signature block cannot be signed", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8006, v);
    await finishRoute(8006, v);
    const r = await sign(8006);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "NO_SIGNATURE_BLOCK");
  });

  it("reopen (retype) → a draft again; when it finishes again a new copy freezes and the old signature no longer counts", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true }));
    await seedReportItem(8007, v);
    await finishRoute(8007, v);
    assert.equal((await sign(8007)).status, 200);
    assert.equal((await status(8007)).state, "final");

    // PUT /api/items/[id] with another type restarts the route on that type (finished_at
    // cleared); back to REPORT restarts it on this route again.
    const edit = (itemType: number) =>
      H.updateItem(8007, { customer: H.CUSTOMER_ID, itemType, serialNumber: "SN-8007", makat: "MK-1", model: "MODEL", manufacturer: "MFR" });
    let re = await edit(H.ITEM_TYPE_ONE_STEP);
    assert.ok(re.status < 300, JSON.stringify(re.body));
    assert.equal((await H.routeRow(8007)).finished_at, null);
    assert.equal((await status(8007)).state, "no_template", "the other type's route has no template");
    re = await edit(ITEM_TYPE_REPORT);
    assert.ok(re.status < 300, JSON.stringify(re.body));
    assert.equal((await status(8007)).state, "in_progress");
    assert.equal((await getPdf(8007)).headers.get("x-report-final"), "0");

    await H.q("UPDATE item_routes SET fields_version = $2, test_station_id = $3 WHERE item_id = $1", [8007, v, H.STATION_FUNC_A]);
    await finishRoute(8007, v);
    const st = await status(8007);
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.signedBy, null);
    assert.equal((await sign(8007)).status, 200);
    assert.equal((await reportRow(8007)).version, 2);
  });

  it("finishing through research also freezes the report", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8008, v);
    await H.startTest({ itemId: 8008, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    const sent = await H.submitResult({
      ItemID: 8008, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), sendToResearch: true,
      Details: { schema: schemaOf(UID.a, v), fields: { [VOLT.id]: { t: "number", value: 27 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } } },
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    await H.startTest({ itemId: 8008, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });
    const done = await H.submitResult({ ItemID: 8008, StationID: H.STATION_RESEARCH, SubmitID: randomUUID(), finishRoute: true });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    await waitForFrozen(8008);
    const html = (await getHtml(8008)).body as string;
    assert.doesNotMatch(html, /RESEARCH-1/, "the research bench is not a route step");
  });

  it("deleting the item deletes its report row", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8009, v);
    await finishRoute(8009, v);
    await waitForFrozen(8009);
    const del = await H.deleteItem(8009);
    assert.ok(del.status < 300, JSON.stringify(del.body));
    assert.equal(await reportRow(8009), null);
  });

  it("two downloads at once right after the finish both answer a final PDF", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: false }));
    await seedReportItem(8010, v);
    await finishRoute(8010, v);
    const [a, b] = await Promise.all([getPdf(8010), getPdf(8010)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.headers.get("x-report-final"), "1");
    assert.equal(b.headers.get("x-report-final"), "1");
    const row = await waitForFrozen(8010);
    assert.ok(stored(row.storage_key), "the row points at an object that exists");
  });

  it("preview: the unsaved template with a real item, or with labels; editors only", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await seedReportItem(8011, v);
    session = signedIn("storekeeper");
    const url = `/api/item-reports/templates/${R.report}/preview`;
    assert.equal((await call(api.preview.POST, url, json("POST", { template: template({ signature: true }) }), { routeId: String(R.report) })).status, 403);
    session = signedIn("tester");
    let r = await call(api.preview.POST, url, json("POST", { template: template({ signature: true }), item_id: "8011" }), { routeId: String(R.report) });
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
    r = await call(api.preview.POST, url, json("POST", { template: template({ signature: true }) }), { routeId: String(R.report) });
    assert.equal(r.status, 200);
    r = await call(api.preview.POST, url, json("POST", { template: template({ signature: true }), item_id: "777" }), { routeId: String(R.report) });
    assert.equal(r.status, 404);
    r = await call(api.preview.POST, url, json("POST", { template: "x" }), { routeId: String(R.report) });
    assert.equal(r.status, 400);
    assert.equal(await reportRow(8011), null, "a preview is never stored");
  });

  it("logos: upload images only, read back only under reports/logos/", async () => {
    session = signedIn("tester");
    let r = await call(api.logo.POST, "/api/item-reports/logo", json("POST", { dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }));
    assert.equal(r.status, 400);
    r = await call(api.logo.POST, "/api/item-reports/logo", json("POST", { dataUrl: PNG }));
    assert.equal(r.status, 200);
    assert.match(r.body.key, /^reports\/logos\/[0-9a-f-]{36}\.png$/);
    const key = r.body.key as string;
    session = signedIn("storekeeper");
    r = await call(api.logo.GET, `/api/item-reports/logo?key=${encodeURIComponent(key)}`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    for (const bad of ["items/1/a.png", "reports/logos/../items/1/a.png", "reports/items/1/v1.pdf"]) {
      r = await call(api.logo.GET, `/api/item-reports/logo?key=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, bad);
    }
    assert.equal((await call(api.logo.POST, "/api/item-reports/logo", json("POST", { dataUrl: PNG }))).status, 403, "storekeeper cannot upload");
  });

  it("the template's text is escaped: markup in a label or a worker's value never becomes HTML", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED, SEAL]), itemStep(UID.b, [CASE])));
    const t = template({ signature: false, marker: "<img src=x onerror=alert(1)>" }) as any;
    t.content[0].props.content.push({ text: " seal=" }, { v: `field.${UID.a}.${SEAL.id}` });
    await saveTemplate(R.report, t);
    await seedReportItem(8012, v);
    await runStep(8012, UID.a, v, { [VOLT.id]: { t: "number", value: 28 }, [LED.id]: { t: "choice_row", opt: "o_led00001" }, [SEAL.id]: { t: "text", value: "<script>x</script>" } });
    const html = (await getHtml(8012)).body as string;
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  });

  it("a kit item: its report carries what was entered for it at the kit's opening (the KIT route's step), then its own steps", async () => {
    const WHOLE: Field = { id: "f_whole001", type: "pass_fail", label: "שלמות הפריט", required: true, notes: "optional" };
    const kv = await publish(R.kit, config({
      uid: UID.kOpen, station_type_id: H.TYPE_INTAKE, station_label: "INTAKE", scope: "package",
      groups: [{ target: "each_item", fields: [WHOLE] }],
    }));
    await H.q("INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number) VALUES ($1, $2, 1, 1)", [H.ITEM_TYPE_PACKAGE_CLOSE, H.ITEM_TYPE_IN_BOX]);
    await saveTemplate(R.inBox, {
      root: { props: { header: { show: false }, footer: { show: false }, border: "none", font: "david", classification: "" } },
      content: [
        { type: "Text", props: { id: "k1", align: "right", width: "full", content: [
          { text: "whole=" }, { v: `field.${UID.kOpen}.${WHOLE.id}` }, { text: " at=" }, { v: `step.${UID.kOpen}.station` },
        ] } },
        { type: "ResultsTable", props: { id: "rt", showFields: true, showStation: true, showWorker: true, showDate: true, showComments: true, width: "full" } },
        { type: "StepFields", props: { id: "sf", step: UID.kOpen, showHeader: true, showNotes: true, width: "full" } },
      ],
      zones: {},
    });
    const kit = await H.h().prisma.$transaction((tx: any) =>
      H.h().createPackage(tx, {
        customer: H.CUSTOMER_ID, shipment: H.SHIPMENT_ID, packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
        items: [{ itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-KIT-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR" }],
      }),
    );
    const [item] = kit.itemIds as number[];
    const kitSchema = { route_id: R.kit, v: kv, step_uid: UID.kOpen };

    // Opening: one result for the item (kit_item) and one for the box.
    await H.startTest({ itemId: kit.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    const submitId = randomUUID();
    let r = await H.submitResult({ ItemID: item, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { schema: { ...kitSchema, target: "kit_item" }, fields: { [WHOLE.id]: { t: "pass_fail", ok: "fail" } } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await H.submitResult({ ItemID: kit.packageId, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { schema: { ...kitSchema, target: "box" }, fields: {} } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await status(item)).state, "in_progress");
    let html = (await getHtml(item)).body as string;
    assert.match(html, /whole=.*לא תקין/);
    assert.match(html, /at=.*INTAKE-1/);
    assert.match(html, /שלמות הפריט/, "the kit step's field in the step table");

    // Its own step, then the closing of the kit.
    await H.startTest({ itemId: item, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    r = await H.submitResult({ ItemID: item, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await H.startTest({ itemId: kit.packageId, stationId: H.STATION_CLOSE, actionUuid: randomUUID() });
    const closeId = randomUUID();
    for (const id of [item, kit.packageId]) {
      r = await H.submitResult({ ItemID: id, StationID: H.STATION_CLOSE, SubmitID: closeId, Passed: true });
      assert.equal(r.status, 200, `closing ${id}: ${JSON.stringify(r.body)}`);
    }
    assert.ok((await H.routeRow(item)).finished_at, "the item finished with its kit");
    await waitForFrozen(item);
    html = (await getHtml(item)).body as string;
    for (const station of ["INTAKE-1", "FUNC-A", "CLOSE-1"]) assert.match(html, new RegExp(station), station);
    assert.match(html, /whole=.*לא תקין/);
    assert.equal(await reportRow(kit.packageId), null, "the box gets no report");
  });

  it("G.getItemReport and the handler agree on the state machine for a finished item with no results rows of the route", async () => {
    await saveTemplate(R.report, template({ signature: false }));
    await H.seedItem({ itemId: 8013, itemTypeId: ITEM_TYPE_REPORT, stationId: H.STATION_FUNC_A });
    await H.q("UPDATE item_routes SET finished_at = NOW(), is_finished = true, current_status = 3 WHERE item_id = 8013");
    const doc = await G.getItemReport(BigInt(8013));
    assert.equal(doc.kind, "pdf");
    if (doc.kind === "pdf") assert.equal(doc.final, true);
    assert.match((await getHtml(8013)).body, /לא נרשמו תוצאות/);
  });
});
