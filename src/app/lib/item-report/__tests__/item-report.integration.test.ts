// Item PDF reports (docs/features/ITEM_REPORTS.md) end to end, through the real handlers: an item runs
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
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AppRole } from "@/lib/auth/roles";
import type { item_reports } from "@prisma/client";
import type { Data } from "@measured/puck";
import type { RootProps } from "../document";
import { NextRequest } from "next/server";
import * as H from "@/test-support/db-harness";
import type { Field, RouteFieldsConfig, StepConfig } from "../../station-fields/schema";
import type { ReportStepRef, ReportVar } from "../types";
import type { ReportStatusResponse } from "../contract";
import { stubSession } from "@/lib/auth/testing";

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
/** The fake MinIO object under a key (none for a row whose key column is still NULL). */
const stored = (key: string | null) => (key == null ? undefined : objects.get(`digitalfactory-files/${key}`)?.body);

// ---------------------------------------------------------------------------
// The session withAuth sees (as fields.integration.test.ts stubs it).
// ---------------------------------------------------------------------------
let session: unknown = null;
const signedIn = (...roles: AppRole[]) => ({
  user: { preferredUsername: "report-http", displayName: "רונית כהן", name: "report-http", employeeNumber: "9001" },
  roles,
});
/** Another person (a tester who may not give the final signature). */
const signedInOther = (...roles: AppRole[]) => ({
  user: { preferredUsername: "report-approver", displayName: "דנה לוי", name: "report-approver", employeeNumber: "9002" },
  roles,
});

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
function template(opts: { signature: boolean; closing?: boolean; external?: boolean; marker?: string }): Data<Record<string, Record<string, unknown>>, RootProps> {
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
      ...(opts.closing
        ? [{ type: "Signature", props: { id: "sgc", bind: "closing", width: "full", cells: [{ kind: "text", text: "CLOSING-ROW" }, { kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } }]
        : []),
      ...(opts.signature
        ? [{ type: "Signature", props: { id: "sg", bind: "final", width: "full", cells: [{ kind: "text", text: "FINAL-ROW" }, { kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } }]
        : []),
      ...(opts.external
        ? [{ type: "Signature", props: { id: "sge", bind: "external", width: "full", cells: [{ kind: "role", text: "EXTERNAL-ROW" }, { kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } }]
        : []),
    ],
    zones: {},
  };
}

/** A full-page PNG of some HTML, from its own Chromium (the test photo). */
async function screenshot(html: string, widthPx: number): Promise<Buffer> {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: CHROMIUM, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: widthPx, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
  } finally {
    await browser.close();
  }
}

/** 1x1 transparent PNG. */
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("item PDF reports — template, draft, freeze at finish, signature, reopen, handlers", { skip: SKIP }, () => {
  let s3: http.Server;
  let A: typeof import("../../station-fields/admin");
  let G: typeof import("../lifecycle");
  let api: {
    report: typeof import("../../../api/item-reports/[itemId]/route");
    status: typeof import("../../../api/item-reports/[itemId]/status/route");
    sign: typeof import("../../../api/item-reports/[itemId]/sign/route");
    signClosing: typeof import("../../../api/item-reports/[itemId]/sign-closing/route");
    approveExternal: typeof import("../../../api/item-reports/[itemId]/approve-external/route");
    template: typeof import("../../../api/item-reports/templates/[routeId]/route");
    preview: typeof import("../../../api/item-reports/templates/[routeId]/preview/route");
    logo: typeof import("../../../api/item-reports/logo/route");
  };

  before(async () => {
    s3 = await startFakeS3();
    // lib/storage/minio.ts reads these when it is first imported — before H.setup() imports any route.
    process.env.MINIO_ENDPOINT = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
    process.env.MINIO_ROOT_USER = "suite";
    process.env.MINIO_ROOT_PASSWORD = "suite-secret";
    process.env.MINIO_VERSIONING = "false";
    stubSession(() => session);
    await H.setup();
    A = await import("../../station-fields/admin");
    G = await import("../lifecycle");
    api = {
      report: await import("../../../api/item-reports/[itemId]/route"),
      status: await import("../../../api/item-reports/[itemId]/status/route"),
      sign: await import("../../../api/item-reports/[itemId]/sign/route"),
      signClosing: await import("../../../api/item-reports/[itemId]/sign-closing/route"),
      approveExternal: await import("../../../api/item-reports/[itemId]/approve-external/route"),
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
    // The migration seeds the general template; a test that wants it puts it back.
    await H.q("DELETE FROM report_general_template");
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
    const saved = await A.saveFieldsDraft(H.h().prisma, routeId, { config: cfg, base_rev: draft_rev }, ACTOR);
    const res = await A.publishFields(H.h().prisma, { route_ids: [routeId], base_revs: { [routeId]: saved.draft_rev }, apply_mode: "new_only" }, ACTOR);
    return res.versions[routeId];
  }

  /** The JSON answers of the report routes, as far as the tests read them (each field only where sent). */
  type ReportApiJson = {
    error?: string;
    code?: string;
    /** sign / sign-closing: the frozen copy's version (0 = not frozen). */
    version?: number;
    /** templates GET: the template, what it can bind, who saved it last, how many routes use it. */
    template?: Data | null;
    steps?: ReportStepRef[];
    vars?: ReportVar[];
    updated_by_name?: string | null;
    routes?: number;
    /** logo upload: the stored object's key. */
    key?: string;
  };
  /** templates GET (a route's or the general one): what the editor opens with. */
  type Catalog = { template: Data | null; steps: ReportStepRef[]; vars: ReportVar[]; updated_by_name: string | null; routes?: number };
  /** A route handler as Next calls it. */
  type Handler = (req: NextRequest, routeCtx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
  /** Calls a handler; the body is its JSON, a PDF's bytes or the text — `B` names which the caller reads. */
  type Init = ConstructorParameters<typeof NextRequest>[1];
  async function call<B = ReportApiJson>(handler: unknown, url: string, init: Init = {}, params?: Record<string, string>) {
    const res = await (handler as Handler)(new NextRequest(`http://localhost${url}`, init), params ? { params: Promise.resolve(params) } : undefined);
    const type = res.headers.get("content-type") ?? "";
    const body: unknown = type.includes("json") ? await res.json() : type.includes("pdf") ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, headers: res.headers, body: body as B };
  }
  const json = (method: string, body: unknown): Init => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

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
  /** An item_reports row as pg reads it here (the suite's parser turns BIGINT into a number). */
  type ReportRowDb = Omit<item_reports, "item_id" | "size_bytes"> & { item_id: number; size_bytes: number };
  async function reportRow(itemId: number) {
    return (await H.q<ReportRowDb>("SELECT * FROM item_reports WHERE item_id = $1", [itemId]))[0] ?? null;
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
  // The registry row is written fire-and-forget after the freeze, so it can land after storage_key does.
  async function waitForRegistered(objectKey: string) {
    for (let i = 0; i < 50; i++) {
      const rows = await H.q("SELECT entity_type, entity_id FROM file_objects WHERE object_key = $1", [objectKey]);
      if (rows.length) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  }
  async function getPdf(itemId: number) {
    session = signedIn("storekeeper");
    return call<Buffer>(api.report.GET, `/api/item-reports/${itemId}`, {}, { itemId: String(itemId) });
  }
  async function getHtml(itemId: number) {
    session = signedIn("storekeeper");
    return call<string>(api.report.GET, `/api/item-reports/${itemId}?html=1`, {}, { itemId: String(itemId) });
  }
  async function status(itemId: number, as: unknown = signedIn("tester")) {
    session = as;
    return (await call<ReportStatusResponse>(api.status.GET, `/api/item-reports/${itemId}/status`, {}, { itemId: String(itemId) })).body;
  }
  /** The final signature (the item page); only a manager may give it. */
  async function sign(itemId: number, roles: AppRole[] = ["manager"], as = signedIn) {
    session = as(...roles);
    return call(api.sign.POST, `/api/item-reports/${itemId}/sign`, json("POST", { signature: PNG }), { itemId: String(itemId) });
  }
  /** The closing signature given on the item page after the fact; a tester or a manager. */
  async function signClosing(itemId: number, roles: AppRole[] = ["tester"], as = signedIn) {
    session = as(...roles);
    return call(api.signClosing.POST, `/api/item-reports/${itemId}/sign-closing`, json("POST", { signature: PNG }), { itemId: String(itemId) });
  }

  // -------------------------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------------------------

  it("the route's catalog: its steps, their fields, the item and report variables", async () => {
    await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    session = signedIn("storekeeper");
    const r = await call<Catalog>(api.template.GET, `/api/item-reports/templates/${R.report}`, {}, { routeId: String(R.report) });
    assert.equal(r.status, 200);
    assert.equal(r.body.template, null);
    assert.deepEqual(r.body.steps.map((s) => s.uid), [UID.a, UID.b]);
    assert.deepEqual(r.body.steps[0].fields.map((f) => f.id), [VOLT.id, LED.id]);
    const names = new Set(r.body.vars.map((v) => v.name));
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
    const r = await call<Catalog>(api.template.GET, `/api/item-reports/templates/${R.inBox}`, {}, { routeId: String(R.inBox) });
    assert.equal(r.status, 200);
    const kitStep = r.body.steps.find((s) => s.uid === UID.kOpen);
    assert.ok(kitStep, "the kit's opening step is offered");
    assert.deepEqual(kitStep.fields.map((f) => f.id), [each.id, own.id]);
    assert.ok(!r.body.steps.some((s) => s.uid === UID.kClose && s.fields.length > 0));
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

  it("the general template: a route without its own gets it, its own wins, a kit's box gets none; its handlers", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await seedReportItem(8201, v);
    assert.equal((await status(8201)).state, "no_template", "no general template yet");

    // Writes: the template roles, never empty.
    const general = await import("../../../api/item-reports/templates/general/route");
    const { generalStarterTemplate } = await import("../starter");
    session = signedIn("storekeeper");
    let r = await call(general.PUT, "/api/item-reports/templates/general", json("PUT", { template: generalStarterTemplate() }));
    assert.equal(r.status, 403);
    session = signedIn("manager");
    r = await call(general.PUT, "/api/item-reports/templates/general", json("PUT", { template: { root: {}, content: [], zones: {} } }));
    assert.equal(r.status, 400, "an empty general template");
    r = await call(general.PUT, "/api/item-reports/templates/general", json("PUT", { template: generalStarterTemplate() }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    session = signedIn("storekeeper");
    const cat = await call<Catalog>(general.GET, "/api/item-reports/templates/general");
    assert.equal(cat.status, 200);
    assert.ok((cat.body.routes ?? 0) >= 1, "the REPORT route uses it");
    assert.deepEqual(cat.body.steps, []);
    assert.ok(!cat.body.vars.some((x: { name: string }) => x.name.startsWith("step.") || x.name.startsWith("field.")), "only what every route has");

    // The item's report: the general template, every station in its detail with what it saved.
    const st = await status(8201);
    assert.equal(st.state, "in_progress");
    assert.equal(st.needsSignature, true);
    await H.startTest({ itemId: 8201, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    const submitted = await H.submitResult({
      ItemID: 8201, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true,
      Details: { schema: schemaOf(UID.a, v), fields: { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } } },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    let html = (await getHtml(8201)).body as string;
    assert.match(html, /פירוט לפי עמדה/);
    assert.match(html, /class="pdf-stepdetail__head"/);
    assert.match(html, /מתח כניסה/, "the route field, in the station's detail");

    // Its own template wins; going back to the general one is deleting it.
    await saveTemplate(R.report, template({ signature: false, marker: "OWN-TEMPLATE" }));
    html = (await getHtml(8201)).body as string;
    assert.match(html, /OWN-TEMPLATE/);
    assert.doesNotMatch(html, /class="pdf-stepdetail__head"/);
    session = signedIn("manager");
    const del = await call(api.template.DELETE, `/api/item-reports/templates/${R.report}`, { method: "DELETE" }, { routeId: String(R.report) });
    assert.equal(del.status, 204);
    assert.match((await getHtml(8201)).body as string, /class="pdf-stepdetail__head"/);

    // A kit's box gets no report, the general template notwithstanding.
    const kit = await H.h().prisma.$transaction((tx) =>
      H.h().createPackage(tx, {
        customer: H.CUSTOMER_ID, shipment: H.SHIPMENT_ID, packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
        items: [{ itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-GEN-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR" }],
      }),
    );
    assert.equal((await status(kit.packageId)).state, "no_template");
    assert.equal((await status((kit.itemIds as number[])[0])).state, "in_progress", "its item does get one");
  });

  it("StepDetails prints each station's photos under it — every source (here the legacy popup's)", async () => {
    await H.q("INSERT INTO report_general_template (id, template) VALUES (1, $1::jsonb)", [JSON.stringify((await import("../starter")).generalStarterTemplate())]);
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await seedReportItem(8202, v);
    await H.startTest({ itemId: 8202, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    const r = await H.submitResult({
      ItemID: 8202, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true,
      Details: { schema: schemaOf(UID.a, v), fields: { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } }, photo: { photos: ["items/8202/a.jpg", "items/8202/b.jpg"] } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const html = (await getHtml(8202)).body as string;
    const detail = html.slice(html.indexOf("פירוט לפי עמדה"));
    assert.equal((detail.match(/class="pdf-photo pdf-keep"/g) ?? []).length, 2, "both shots, under the station");
  });

  it("a big photo goes into the report small (JPEG, ≤ PDF_PHOTO_MAX_PX), a small one as it is; MinIO keeps the original", async () => {
    const { PDF_PHOTO_MAX_PX } = await import("../render");
    // A camera-sized shot: 3000 px wide noise (it does not compress), a few MB as PNG.
    const noise = `<canvas id="c" width="1500" height="1123"></canvas><script>
      const c = document.getElementById("c"), g = c.getContext("2d"), d = g.createImageData(1500, 1123);
      for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0;
      g.putImageData(d, 0, 0);</script>`;
    const big = await screenshot(`<html><body style="margin:0">${noise}</body></html>`, 1500);
    assert.ok(big.length > 1024 * 1024, `the test photo is big (${big.length} bytes)`);
    const tiny = Buffer.from(PNG.split(",")[1]!, "base64");
    objects.set("digitalfactory-files/items/8203/big.png", { body: big, type: "image/png" });
    objects.set("digitalfactory-files/items/8203/tiny.png", { body: tiny, type: "image/png" });

    await H.q("INSERT INTO report_general_template (id, template) VALUES (1, $1::jsonb)", [JSON.stringify((await import("../starter")).generalStarterTemplate())]);
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await seedReportItem(8203, v);
    await H.startTest({ itemId: 8203, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
    const r = await H.submitResult({
      ItemID: 8203, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true,
      Details: { schema: schemaOf(UID.a, v), fields: { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } }, photo: { photos: ["items/8203/big.png", "items/8203/tiny.png"] } },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const html = (await getHtml(8203)).body as string;
    const srcs = [...html.matchAll(/<img src="(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]!);
    const jpegs = srcs.filter((s) => s.startsWith("data:image/jpeg"));
    assert.equal(jpegs.length, 1, "the big photo, as a JPEG");
    const small = Buffer.from(jpegs[0]!.split(",")[1]!, "base64");
    assert.ok(small.length < big.length / 4, `made small: ${big.length} → ${small.length} bytes`);
    // The JPEG's size from its SOF marker.
    let w = 0, h = 0;
    for (let i = 2; i < small.length - 9; ) {
      if (small[i] !== 0xff) { i++; continue; }
      const m = small[i + 1]!;
      if (m >= 0xc0 && m <= 0xc3) { h = small.readUInt16BE(i + 5); w = small.readUInt16BE(i + 7); break; }
      i += 2 + small.readUInt16BE(i + 2);
    }
    assert.equal(Math.max(w, h), PDF_PHOTO_MAX_PX, `longer side ${w}×${h}`);
    assert.ok(srcs.includes(PNG), "the small photo goes in as it is");
    assert.deepEqual(stored("items/8203/big.png"), big, "the stored photo is untouched");

    // The PDF itself renders with it.
    assert.equal((await getPdf(8203)).status, 200);
  });

  it("the closing signature, sent with the finishing result, is recorded in the same request but does not lock; the final one locks it", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true, closing: true }));
    await seedReportItem(8101, v);
    const results = async () => (await H.q("SELECT 1 FROM test_results WHERE item_id = $1", [8101])).length;
    const start = async () => {
      const started = await H.startTest({ itemId: 8101, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
      assert.equal(started.status, 200, JSON.stringify(started.body));
    };
    const send = (uid: string, fields: Record<string, unknown>, signature: unknown) =>
      H.submitResult({ ItemID: 8101, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true, Details: { schema: schemaOf(uid, v), fields }, ReportSignature: signature });
    const step1 = { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } };

    // No right to sign, or no usable signature: nothing is saved (the item stays in its test).
    await start();
    session = signedIn("storekeeper");
    let r = await send(UID.a, step1, PNG);
    assert.equal(r.status, 403);
    session = signedIn("tester");
    r = await send(UID.a, step1, "data:text/plain;base64,eA==");
    assert.equal(r.status, 400);
    assert.equal(await results(), 0);

    // A step that does not finish the route: saved, nothing to sign yet. The draft marks the
    // closing's spot, the one the closing signs.
    r = await send(UID.a, step1, PNG);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.reportSign, "nothing_to_sign");
    assert.equal(await reportRow(8101), null);
    let st = await status(8101);
    assert.equal(st.needsClosingSignature, true);
    assert.equal(st.canSignClosing, true, "a tester signs at the closing");
    assert.equal(st.canSign, false, "…but never the final signature");
    assert.match((await getHtml(8101)).body, /CLOSING-ROW[\s\S]*חתום\/י כאן[\s\S]*FINAL-ROW/);

    // The finishing step: saved and signed before the answer — but not frozen: the final
    // signature is still to come.
    await start();
    session = signedIn("tester");
    r = await send(UID.b, { [CASE.id]: { t: "pass_fail", ok: "pass" } }, PNG);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.reportSign, "signed");
    await new Promise((res) => setTimeout(res, 1500)); // the detached freeze has nothing to do
    let row = await reportRow(8101);
    assert.ok(row?.closing_signature_key && stored(row.closing_signature_key), "the closing signature, stored");
    assert.equal(row.closing_signed_by_name, "רונית כהן");
    assert.equal(row.closing_signed_by_number, "9001");
    assert.equal(row.closing_signed_by_role, "בודק", "the closing keeps the signer's role");
    assert.equal(row.signature_key, null);
    assert.equal(row.storage_key, null, "not locked by the closing signature");
    st = await status(8101);
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.closingSignedBy, "רונית כהן");
    assert.equal(st.signedBy, null);
    let html = (await getHtml(8101)).body as string;
    assert.match(html, /CLOSING-ROW[\s\S]*רונית כהן[\s\S]*<img src="data:image\/png;base64,[\s\S]*FINAL-ROW[\s\S]*חתום\/י כאן/, "signed at the closing; the final spot waits");
    assert.match(html, /class="pdf-draftmark"/);

    // A tester never gives the final signature.
    assert.equal((await sign(8101, ["tester"], signedInOther)).status, 403);

    // A manager does — the same person who signed at the closing too: frozen with both signatures.
    st = await status(8101, signedIn("manager"));
    assert.equal(st.canSign, true);
    const signed = await sign(8101, ["manager"]);
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.body.version, 1);
    row = await reportRow(8101);
    assert.ok(row.storage_key, "locked by the final signature");
    assert.equal(row.signed_by_name, "רונית כהן");
    assert.equal(row.closing_signed_by, row.signed_by, "one person, both signatures");
    st = await status(8101);
    assert.equal(st.state, "final");
    html = (await getHtml(8101)).body as string;
    assert.match(html, /CLOSING-ROW[\s\S]*רונית כהן[\s\S]*FINAL-ROW[\s\S]*רונית כהן/);
    assert.equal((html.match(/<img src="data:image\/png;base64,/g) ?? []).length, 2, "both drawn signatures");
    assert.doesNotMatch(html, /class="pdf-draftmark"/);
  });

  it("the closing signature after the fact, on the item page: a tester or a manager, once, before the lock; the final one then locks with both", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true, closing: true }));

    // Still in its route: nothing to sign yet.
    await seedReportItem(8111, v);
    let r = await signClosing(8111);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "NOT_FINISHED");

    // Finished without the closing signature (the box closed before the template had it).
    await seedReportItem(8112, v);
    await finishRoute(8112, v);
    await new Promise((res) => setTimeout(res, 1500)); // the detached freeze has nothing to do
    let st = await status(8112);
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.needsClosingSignature, true);
    assert.equal(st.closingSignedBy, null, "the closing signature is missing");

    // Only a tester or a manager; and a PNG.
    assert.equal((await signClosing(8112, ["storekeeper"])).status, 403);
    session = signedIn("tester");
    r = await call(api.signClosing.POST, "/api/item-reports/8112/sign-closing", json("POST", { signature: "data:image/jpeg;base64,AAAA" }), { itemId: "8112" });
    assert.equal(r.status, 400);
    assert.equal((await reportRow(8112))?.closing_signature_key ?? null, null);

    // A tester signs: kept with this finish, the report still waits for the final signature.
    r = await signClosing(8112);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 0, "not locked");
    let row = await reportRow(8112);
    assert.ok(row?.closing_signature_key && stored(row.closing_signature_key), "the closing signature, stored");
    assert.equal(row.closing_signed_by_name, "רונית כהן");
    assert.equal(row.storage_key, null);
    st = await status(8112);
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.closingSignedBy, "רונית כהן");
    assert.match((await getHtml(8112)).body, /CLOSING-ROW[\s\S]*רונית כהן[\s\S]*<img src="data:image\/png;base64,[\s\S]*FINAL-ROW[\s\S]*חתום\/י כאן/);

    // Once per finish.
    r = await signClosing(8112, ["manager"]);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_SIGNED");

    // The final signature locks it with both.
    assert.equal((await sign(8112)).status, 200);
    row = await reportRow(8112);
    assert.ok(row.storage_key, "locked");
    const html = (await getHtml(8112)).body as string;
    assert.equal((html.match(/<img src="data:image\/png;base64,/g) ?? []).length, 2, "both drawn signatures");

    // The other order: the final signature first locks the report with the closing spot blank —
    // after that the closing signature can no longer be given.
    await seedReportItem(8113, v);
    await finishRoute(8113, v);
    assert.equal((await sign(8113)).status, 200);
    r = await signClosing(8113, ["manager"]);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_FINAL");
    assert.equal((await reportRow(8113)).closing_signature_key, null);

    // A template without the closing block: nothing to sign there.
    await saveTemplate(R.report, template({ signature: true }));
    await seedReportItem(8114, v);
    await finishRoute(8114, v);
    r = await signClosing(8114);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "NO_SIGNATURE_BLOCK");
  });

  it("the closing row's role cell prints the signer's role when they signed (בודק / מנהל); the final row keeps its text", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    const t = template({ signature: false });
    t.content.push(
      { type: "Text", props: { id: "rv", align: "right", width: "full", content: [{ text: "ROLEVAR=" }, { v: "report.closing_signer_role" }, { text: "=END" }] } },
      { type: "Signature", props: { id: "sgc", bind: "closing", width: "full", cells: [{ kind: "text", text: "CLOSING-ROW" }, { kind: "role", label: "תפקיד", text: "OLD-ROLE" }, { kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } },
      { type: "Signature", props: { id: "sg", bind: "final", width: "full", cells: [{ kind: "text", text: "FINAL-ROW" }, { kind: "text", label: "תפקיד", text: "מאשר סופי" }, { kind: "fullName", label: "שם" }, { kind: "signature", label: "חתימה" }] } },
    );
    await saveTemplate(R.report, t);
    const closingRow = async (itemId: number) => {
      const html = (await getHtml(itemId)).body as string;
      return { closing: html.slice(html.indexOf("CLOSING-ROW"), html.indexOf("FINAL-ROW")), final: html.slice(html.indexOf("FINAL-ROW")), html };
    };
    const finished = async (itemId: number) => { await seedReportItem(itemId, v); await finishRoute(itemId, v); };

    // Not signed yet: the role cell is empty (its text is only for an older signature).
    await finished(8121);
    let rows = await closingRow(8121);
    assert.doesNotMatch(rows.closing, /OLD-ROLE|בודק|מנהל/);
    assert.match(rows.final, /מאשר סופי/);

    // A tester signs: "בודק", kept with the signature; the variable has it too.
    assert.equal((await signClosing(8121, ["tester"])).status, 200);
    assert.equal((await reportRow(8121)).closing_signed_by_role, "בודק");
    rows = await closingRow(8121);
    assert.match(rows.closing, /בודק/);
    assert.match(rows.html, /ROLEVAR=(?:<[^>]*>)*בודק(?:<[^>]*>)*=END/, "the variable, between its markup");
    // The manager's final signature locks it — the closing row keeps "בודק", the final row its text.
    assert.equal((await sign(8121)).status, 200);
    rows = await closingRow(8121);
    assert.match(rows.closing, /בודק/);
    assert.doesNotMatch(rows.closing, /מנהל/);
    assert.match(rows.final, /מאשר סופי/);
    assert.doesNotMatch(rows.final, /מנהל/);

    // A manager signs at the closing: "מנהל" — also one who is a tester too.
    await finished(8122);
    assert.equal((await signClosing(8122, ["manager"])).status, 200);
    assert.match((await closingRow(8122)).closing, /מנהל/);
    await finished(8123);
    assert.equal((await signClosing(8123, ["tester", "manager"])).status, 200);
    assert.equal((await reportRow(8123)).closing_signed_by_role, "מנהל");

    // A closing signature from before roles were kept prints the cell's own text.
    await H.q("UPDATE item_reports SET closing_signed_by_role = NULL WHERE item_id = 8123");
    rows = await closingRow(8123);
    assert.match(rows.closing, /OLD-ROLE/);
    assert.doesNotMatch(rows.closing, /מנהל/);
  });

  it("a template with only the closing signature: the closing signs and locks it; with only the final one the closing has nothing to sign", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    const finishWithSignature = async (itemId: number) => {
      await seedReportItem(itemId, v);
      await runStep(itemId, UID.a, v, { [VOLT.id]: { t: "number", value: 27.9 }, [LED.id]: { t: "choice_row", opt: "o_led00001" } });
      session = signedIn("tester");
      await H.startTest({ itemId, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
      const r = await H.submitResult({
        ItemID: itemId, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true,
        Details: { schema: schemaOf(UID.b, v), fields: { [CASE.id]: { t: "pass_fail", ok: "pass" } } }, ReportSignature: PNG,
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.reportSign;
    };

    await saveTemplate(R.report, template({ signature: false, closing: true }));
    assert.equal(await finishWithSignature(8102), "signed");
    let row = await reportRow(8102);
    assert.ok(row?.closing_signature_key && row.storage_key, "signed at the closing and frozen with it");
    assert.equal((await status(8102)).state, "final");
    assert.match((await getHtml(8102)).body, /CLOSING-ROW[\s\S]*רונית כהן/);

    await saveTemplate(R.report, template({ signature: true }));
    assert.equal(await finishWithSignature(8103), "nothing_to_sign");
    row = await reportRow(8103);
    assert.equal(row?.closing_signature_key ?? null, null);
    const st = await status(8103);
    assert.equal(st.state, "awaiting_signature", "waits for the final signature on the item page");
    assert.equal(st.needsClosingSignature, false);

    // A closing block on a route that never passes a closing: frozen at the finish, the spot blank.
    await saveTemplate(R.report, template({ signature: false, closing: true }));
    await seedReportItem(8104, v);
    await finishRoute(8104, v);
    await waitForFrozen(8104);
    assert.equal((await status(8104)).state, "final");
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
    assert.deepEqual(await waitForRegistered(row.storage_key), [{ entity_type: "item_report", entity_id: "8003" }]);

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

  it("a final signature block: finished → awaiting the signature; only a manager, once, then frozen with it", async () => {
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
    assert.equal(st.canSign, false, "a tester does not give the final signature");
    assert.equal((await status(8005, signedIn("manager"))).canSign, true);
    const draft = await getPdf(8005);
    assert.equal(draft.headers.get("x-report-final"), "0");
    assert.match((await getHtml(8005)).body, /חתום\/י כאן/);

    assert.equal((await sign(8005, ["storekeeper"])).status, 403);
    assert.equal((await sign(8005, ["tester"])).status, 403);
    session = signedIn("manager");
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

  it("an external approval of a failed report: a manager only, name + signature; the failed step passes, the report locks with it in place of the final row", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true, external: true }));
    await seedReportItem(8020, v);
    await finishRoute(8020, v);
    const approve = (body: Record<string, unknown>, roles: AppRole[] = ["manager"]) => {
      session = signedIn(...roles);
      return call(api.approveExternal.POST, "/api/item-reports/8020/approve-external", json("POST", body), { itemId: "8020" });
    };
    const good = { name: "משה ברק", role: "נציג היצרן", note: "הקיבולת תקינה לפי היצרן", signature: PNG };

    let st = await status(8020, signedIn("manager"));
    assert.equal(st.state, "awaiting_signature");
    assert.equal(st.failed, false);
    let r = await approve(good);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "NOT_FAILED", "a report that passed has nothing to approve");

    // Step a's result fails.
    const stepA = await H.one<{ id: number }>(
      `SELECT test_result_id AS id FROM test_results WHERE item_id = 8020 AND details->'schema'->>'step_uid' = $1 ORDER BY created_at DESC LIMIT 1`, [UID.a]);
    await H.q(`UPDATE test_results SET passed = false, details = jsonb_set(details, '{verdict}', '{"ok":"fail","note":"קיבולת נמוכה"}') WHERE test_result_id = $1`, [stepA.id]);
    st = await status(8020, signedIn("manager"));
    assert.equal(st.failed, true);
    assert.ok((await G.itemsAwaitingFinalSignature([BigInt(8020)])).has("8020"));
    assert.ok((await G.itemsWithFailedResults([BigInt(8020)])).has("8020"), "the packages list: waits for an external approval");
    let html = (await getHtml(8020)).body as string;
    assert.match(html, /verdict=<span class="pdf-fill"><bdi>לא תקין</);
    assert.match(html, /FINAL-ROW/);
    assert.doesNotMatch(html, /EXTERNAL-ROW/, "the external row prints only once approved");

    assert.equal((await approve(good, ["tester"])).status, 403);
    assert.equal((await approve(good, ["storekeeper"])).status, 403);
    assert.equal((await approve({ ...good, name: "  " })).status, 400, "a name is required");
    assert.equal((await approve({ ...good, signature: "data:image/jpeg;base64,AAAA" })).status, 400, "PNG only");
    assert.equal((await approve({ ...good, name: "x".repeat(201) })).status, 400);

    r = await approve(good);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 1);
    assert.equal((r.body as { passed?: number }).passed, 1);

    // The result itself passed, with the approval and what it was before kept.
    const res = await H.one<{ passed: boolean; details: { verdict: { ok: string; note: string }; external_approval: Record<string, unknown> } }>(
      "SELECT passed, details FROM test_results WHERE test_result_id = $1", [stepA.id]);
    assert.equal(res.passed, true);
    assert.equal(res.details.verdict.ok, "pass");
    assert.equal(res.details.verdict.note, "קיבולת נמוכה", "the rest of the verdict stays");
    assert.equal(res.details.external_approval.name, "משה ברק");
    assert.equal(res.details.external_approval.presented_by_name, "רונית כהן");
    assert.deepEqual(res.details.external_approval.previous, { passed: false, verdict: { ok: "fail", note: "קיבולת נמוכה" } });

    const row = await reportRow(8020);
    assert.equal(row.external_signed_by_name, "משה ברק");
    assert.equal(row.external_signed_by_role, "נציג היצרן");
    assert.equal(row.external_note, "הקיבולת תקינה לפי היצרן");
    assert.equal(row.external_presented_by_name, "רונית כהן");
    assert.ok(stored(row.external_signature_key));
    assert.equal(row.signature_key, null, "no final signature");

    st = await status(8020);
    assert.equal(st.state, "final");
    assert.equal(st.externalApprovedBy, "משה ברק");
    assert.equal(st.externalApprovedRole, "נציג היצרן");
    assert.equal(st.externalPresentedBy, "רונית כהן");
    assert.equal(st.signedBy, null);
    assert.equal((await getPdf(8020)).headers.get("x-report-final"), "1");
    assert.equal((await G.itemsAwaitingFinalSignature([BigInt(8020)])).size, 0, "no longer waits for the approver");
    assert.equal((await G.itemsWithFailedResults([BigInt(8020)])).size, 0, "nor for an external approval");

    html = (await getHtml(8020)).body as string;
    assert.match(html, /verdict=<span class="pdf-fill"><bdi>תקין \(אושר ע״י גורם חיצוני\)</);
    assert.match(html, /תקין <span class="pdf-approved-mark">\*<\/span>/, "the passed step is marked");
    assert.match(html, /נמצא לא תקין בבדיקה, ואושר כתקין ע״י גורם חיצוני/, "the footnote");
    assert.match(html, /EXTERNAL-ROW/);
    assert.match(html, /משה ברק/);
    assert.match(html, /נציג היצרן/);
    assert.match(html, /נימוק: הקיבולת תקינה לפי היצרן/);
    assert.match(html, /הוצג לגורם החיצוני ע״י המנהל רונית כהן/);
    assert.doesNotMatch(html, /FINAL-ROW/, "the final row gives way to it");
    assert.doesNotMatch(html, /class="pdf-draftmark"/);

    r = await approve(good);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_APPROVED");
    r = await sign(8020);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_SIGNED", "no final signature after it");
  });

  it("an external approval waits for the closing signature when the template asks for it; then it locks with both", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    await saveTemplate(R.report, template({ signature: true, closing: true, external: true }));
    await seedReportItem(8023, v);
    await finishRoute(8023, v);
    await H.q(`UPDATE test_results SET passed = false, details = jsonb_set(details, '{verdict}', '{"ok":"fail"}') WHERE item_id = 8023 AND details->'schema'->>'step_uid' = $1`, [UID.a]);
    const approve = () => {
      session = signedIn("manager");
      return call(api.approveExternal.POST, "/api/item-reports/8023/approve-external", json("POST", { name: "משה", signature: PNG }), { itemId: "8023" });
    };

    let r = await approve();
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "CLOSING_MISSING", "the closing signature comes first");
    assert.equal((await H.q("SELECT 1 FROM test_results WHERE item_id = 8023 AND passed = false")).length, 1, "nothing was passed");
    assert.equal((await reportRow(8023))?.external_signature_key ?? null, null);

    assert.equal((await signClosing(8023)).status, 200);
    r = await approve();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const st = await status(8023);
    assert.equal(st.state, "final");
    assert.ok(st.closingSignedBy && st.externalApprovedBy, "locked with both");
  });

  it("a closing signature missing on a report an external approval already locked can still be added: frozen again with both", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    // Approved without a closing signature (as before the closing one was required first).
    await saveTemplate(R.report, template({ signature: true, external: true }));
    await seedReportItem(8024, v);
    await finishRoute(8024, v);
    await H.q(`UPDATE test_results SET passed = false, details = jsonb_set(details, '{verdict}', '{"ok":"fail"}') WHERE item_id = 8024 AND details->'schema'->>'step_uid' = $1`, [UID.a]);
    session = signedIn("manager");
    let r = await call(api.approveExternal.POST, "/api/item-reports/8024/approve-external", json("POST", { name: "משה", signature: PNG }), { itemId: "8024" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 1);

    await saveTemplate(R.report, template({ signature: true, closing: true, external: true }));
    let st = await status(8024);
    assert.equal(st.state, "final");
    assert.equal(st.closingSignedBy, null);
    assert.equal((await signClosing(8024, ["storekeeper"])).status, 403);
    r = await signClosing(8024);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 2, "frozen again");
    st = await status(8024);
    assert.ok(st.closingSignedBy && st.externalApprovedBy);
    assert.equal(st.version, 2);
    assert.match((await getHtml(8024)).body as string, /CLOSING-ROW/);
    r = await signClosing(8024);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_SIGNED");

    // A report locked by the final signature stays as it was.
    await seedReportItem(8025, v);
    await finishRoute(8025, v);
    assert.equal((await sign(8025)).status, 200);
    r = await signClosing(8025);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_FINAL");
  });

  it("an external approval needs a report still open: not after the final signature, not on a template without one", async () => {
    const v = await publish(R.report, config(itemStep(UID.a, [VOLT, LED]), itemStep(UID.b, [CASE])));
    const fail = (itemId: number) =>
      H.q(`UPDATE test_results SET passed = false, details = jsonb_set(details, '{verdict}', '{"ok":"fail"}') WHERE item_id = $1 AND details->'schema'->>'step_uid' = $2`, [itemId, UID.a]);
    const approve = (itemId: number) => {
      session = signedIn("manager");
      return call(api.approveExternal.POST, `/api/item-reports/${itemId}/approve-external`, json("POST", { name: "משה", signature: PNG }), { itemId: String(itemId) });
    };

    await saveTemplate(R.report, template({ signature: true, external: true }));
    await seedReportItem(8021, v);
    let r = await approve(8021);
    assert.equal(r.body.code, "NOT_FINISHED");
    await finishRoute(8021, v);
    await fail(8021);
    assert.equal((await sign(8021)).status, 200, "the approver signed it as it is");
    r = await approve(8021);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_SIGNED");

    // Without a final signature the report freezes at the finish: nothing left to approve.
    await saveTemplate(R.report, template({ signature: false, external: true }));
    await seedReportItem(8022, v);
    await finishRoute(8022, v);
    await waitForFrozen(8022);
    await fail(8022);
    r = await approve(8022);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ALREADY_FINAL");
    assert.equal((await status(8022, signedIn("manager"))).failed, false, "the button does not show");
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
    let r = await call<Buffer>(api.preview.POST, url, json("POST", { template: template({ signature: true }), item_id: "8011" }), { routeId: String(R.report) });
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
    let r = await call<{ key?: string; error?: string }>(api.logo.POST, "/api/item-reports/logo", json("POST", { dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }));
    assert.equal(r.status, 400);
    r = await call(api.logo.POST, "/api/item-reports/logo", json("POST", { dataUrl: PNG }));
    assert.equal(r.status, 200);
    assert.match(r.body.key ?? "", /^reports\/logos\/[0-9a-f-]{36}\.png$/);
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
    const t = template({ signature: false, marker: "<img src=x onerror=alert(1)>" });
    // The marker Text block's rich content (template() builds it as an array of runs).
    (t.content[0].props.content as unknown[]).push({ text: " seal=" }, { v: `field.${UID.a}.${SEAL.id}` });
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
    const kit = await H.h().prisma.$transaction((tx) =>
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
