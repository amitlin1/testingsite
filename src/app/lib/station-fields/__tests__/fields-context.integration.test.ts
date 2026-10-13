// Integration suite for GET /api/settings/testing-routes/fields-context (route-fields spec §3.2,
// §5.4.6, §5.17): the one read the fields map is built from — the kit's route, every template
// line with its item route and package_seq range, or a single item route — against a real
// database. Every route in it must be exactly what GET …/[id]/fields answers for that route, and
// a failure anywhere must be a real error, never an empty context (artboard 11).
//
// The rules live in context.ts, and most tests call buildFieldsContext directly; the handler is
// not wrapped in withAuth (reads are gated by the middleware only, spec §3.0), so the HTTP tests
// invoke it as Next would. A type-level assertion below makes the compiler check that the server
// object, through JSON, is exactly the wire contract FieldsContextJson (admin-types.ts).
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database carrying the station-fields
// migration; without it the describe block is skipped. It borrows the write-path harness:
// setup() points DATABASE_URL at the scratch database before anything imports the Prisma client
// and holds the ledger suites' advisory lock for the life of this file; resetDb() wipes the
// operational tables before every test (testing_routes with CASCADE, so route_field_versions too).
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { AdminFieldsError } from "../admin";
import type { FieldsContextJson } from "../admin-types";
import type { FieldsContext } from "../context";
import type { Field, RouteFieldsConfig, StepConfig } from "../schema";

// ---------------------------------------------------------------------------
// The wire contract, checked by the compiler
// ---------------------------------------------------------------------------

/** What JSON.stringify makes of a server value: a Date travels as its ISO string. */
type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
/** true only when X and Y are the same type: a member missing, extra or optional on one side only
 *  makes it false. */
type Equal<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false;
/** Does not compile unless buildFieldsContext's result, through JSON, is exactly FieldsContextJson. */
const SERVER_MATCHES_WIRE: Equal<Wire<FieldsContext>, FieldsContextJson> = true;

// ---------------------------------------------------------------------------
// Fixture. On top of the write-path world (station types 10 INTAKE and 40 CLOSE package-level,
// 20 FUNC, 30 RESEARCH and 99 ORPHAN per item; the kit PACKAGE_CLOSE = [INTAKE, CLOSE] with its
// items IN_BOX / IN_BOX_ALT = [INTAKE, FUNC, CLOSE]; the kit PACKAGE = [INTAKE]) this suite adds
// an item type without a route and a kit without contents, and gives PACKAGE_CLOSE a template of
// three lines, in an order that is not their insertion order:
//   IN_BOX_ALT ×1, sort_order 0              → package_seq 1
//   IN_BOX     ×2, sort_order 1 (first id)   → 2–3, its route shared with the kit PACKAGE
//   UNROUTED   ×3, sort_order 1 (later id)   → 4–6, its route missing
// ---------------------------------------------------------------------------

const KIT = H.ITEM_TYPE_PACKAGE_CLOSE;
/** The second kit, whose template also runs IN_BOX's route 1. */
const OTHER_KIT = H.ITEM_TYPE_PACKAGE;
/** Plain item type without a route. */
const ITEM_TYPE_UNROUTED = 21;
/** A kit type without contents and without a route. */
const ITEM_TYPE_EMPTY_KIT = 22;

/** The write-path fixture's station types, as the map labels them (TRIM(test_type_desc)). */
const STATIONS = {
  [H.TYPE_INTAKE]: { label: "INTAKE", package_level: true },
  [H.TYPE_FUNC]: { label: "FUNC", package_level: false },
  [H.TYPE_RESEARCH]: { label: "RESEARCH", package_level: false },
  [H.TYPE_ORPHAN]: { label: "ORPHAN", package_level: false },
  [H.TYPE_CLOSE]: { label: "CLOSE", package_level: true },
};

const UID = {
  kOpen: "s_kopen001", kClose: "s_kclose01",                         // the kit's route
  bOpen: "s_bopen001", bFunc: "s_bfunc001", bClose: "s_bclose01",    // IN_BOX
  aOpen: "s_aopen001", aFunc: "s_afunc001", aClose: "s_aclose01",    // IN_BOX_ALT
  oOpen: "s_oopen001",                                               // the other kit's route
} as const;

/** test_route_id of each route, and the id of each template line, resolved after every reset. */
const R = { kit: 0, inBox: 0, alt: 0, otherKit: 0 };
const LINE = { alt: 0, inBox: 0, unrouted: 0 };

const ACTOR = { username: "context-suite", name: "Context Suite" };

const SEAL: Field = { id: "f_seal0001", type: "pass_fail", label: "מדבקת סגירה", required: true, notes: "optional" };
const INSULATION: Field = { id: "f_ins00001", type: "pass_fail", label: "בדיקת בידוד", required: false, notes: "optional" };

const config = (...steps: StepConfig[]): RouteFieldsConfig =>
  ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });
/** A draft on the kit's opening step: fields on the box. */
const KIT_DRAFT = config({
  uid: UID.kOpen, station_type_id: H.TYPE_INTAKE, station_label: "INTAKE", scope: "package",
  groups: [{ target: "box", fields: [SEAL] }],
});
/** Version 1 of IN_BOX's route: fields at its FUNC step. */
const IN_BOX_V1 = config({
  uid: UID.bFunc, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item",
  groups: [{ target: "item", fields: [INSULATION] }],
});

describe(
  "station fields — GET fields-context: the kit's route, its template lines with their item routes and seq ranges, or one item route",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — fields-context integration suite skipped" },
  () => {
    let A: typeof import("../admin");
    let C: typeof import("../context");
    let prisma: (typeof import("../../prisma"))["prisma"];
    let getContext: (req: Request) => Promise<Response>;
    let getContents: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

    before(async () => {
      // MUST come first: it points DATABASE_URL at the scratch database before anything imports
      // the Prisma client, and takes the advisory lock.
      await H.setup();
      A = await import("../admin");
      C = await import("../context");
      prisma = (await import("../../prisma")).prisma;
      getContext = (await import("../../../api/settings/testing-routes/fields-context/route")).GET;
      getContents = (await import("../../../api/settings/item-types/[id]/contents/route")).GET;
    });
    after(async () => {
      await H.teardown();
    });
    beforeEach(async () => {
      await H.resetDb();
      await H.q(
        `INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'UNROUTED', false), ($2, 'EMPTY_KIT', true)`,
        [ITEM_TYPE_UNROUTED, ITEM_TYPE_EMPTY_KIT],
      );
      R.kit = await giveUids(KIT, [UID.kOpen, UID.kClose]);
      R.inBox = await giveUids(H.ITEM_TYPE_IN_BOX, [UID.bOpen, UID.bFunc, UID.bClose]);
      R.alt = await giveUids(H.ITEM_TYPE_IN_BOX_ALT, [UID.aOpen, UID.aFunc, UID.aClose]);
      R.otherKit = await giveUids(OTHER_KIT, [UID.oOpen]);
      LINE.inBox = await insertLine(KIT, H.ITEM_TYPE_IN_BOX, 2, 1);
      LINE.alt = await insertLine(KIT, H.ITEM_TYPE_IN_BOX_ALT, 1, 0);
      LINE.unrouted = await insertLine(KIT, ITEM_TYPE_UNROUTED, 3, 1);
      await insertLine(OTHER_KIT, H.ITEM_TYPE_IN_BOX, 1, 0);
      // Something in every state the payload carries: a draft on the kit, a version on IN_BOX.
      await A.saveFieldsDraft(prisma, R.kit, { config: KIT_DRAFT, base_rev: 0 }, ACTOR);
      const rev = (await A.saveFieldsDraft(prisma, R.inBox, { config: IN_BOX_V1, base_rev: 0 }, ACTOR)).draft_rev;
      await A.publishFields(prisma, { route_ids: [R.inBox], base_revs: { [R.inBox]: rev }, apply_mode: "new_only" }, ACTOR);
    });

    // -------------------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------------------

    async function giveUids(itemTypeId: number, uids: string[]): Promise<number> {
      const row = await H.one<{ test_route_id: number }>(
        `UPDATE testing_routes SET step_uids = $2::text[]
          WHERE item_type_id = $1 AND route_number = 1 RETURNING test_route_id`,
        [itemTypeId, uids],
      );
      return row.test_route_id;
    }

    async function insertLine(kit: number, itemTypeId: number, quantity: number, sortOrder: number): Promise<number> {
      const row = await H.one<{ id: number }>(
        `INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order)
         VALUES ($1, $2, $3, 1, $4) RETURNING id`,
        [kit, itemTypeId, quantity, sortOrder],
      );
      return row.id;
    }

    async function rejectsAdmin(p: Promise<unknown>, status: number, code: string): Promise<AdminFieldsError> {
      try {
        await p;
      } catch (e) {
        assert.ok(e instanceof A.AdminFieldsError, `expected AdminFieldsError, got ${String(e)}`);
        assert.equal(e.status, status, `${e.code}: ${e.message}`);
        assert.equal(e.code, code);
        return e;
      }
      assert.fail(`expected ${status} ${code}, got success`);
    }

    /** GET …/fields-context?<qs>, invoked as Next would. */
    async function httpContext(qs: string): Promise<{ status: number; body: any }> {
      const res = await getContext(new Request(`http://localhost/api/settings/testing-routes/fields-context?${qs}`));
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    /** The lines as [line_id, item_type_id, desc, quantity, sort_order, seq_from, seq_to, route_number]. */
    const lineRows = (ctx: FieldsContext) =>
      ctx.lines.map((l) => [l.line_id, l.item_type_id, l.item_type_desc, l.quantity, l.sort_order, l.seq_from, l.seq_to, l.route_number]);

    const KIT_LINES = () => [
      [LINE.alt, H.ITEM_TYPE_IN_BOX_ALT, "IN_BOX_ALT", 1, 0, 1, 1, 1],
      [LINE.inBox, H.ITEM_TYPE_IN_BOX, "IN_BOX", 2, 1, 2, 3, 1],
      [LINE.unrouted, ITEM_TYPE_UNROUTED, "UNROUTED", 3, 1, 4, 6, 1],
    ];

    // -------------------------------------------------------------------------------------
    // Package
    // -------------------------------------------------------------------------------------

    it("package: the kit's route and every template line in sort_order (then id), each with its seq range and its item route exactly as GET …/[id]/fields answers it; a line whose route is missing is null with ROUTE_MISSING; every station type is labelled", async () => {
      const ctx = await C.buildFieldsContext(prisma, { packageTypeId: KIT, routeNumber: 1 });
      assert.equal(ctx.kind, "package");
      assert.deepEqual(ctx.subject, { item_type_id: KIT, desc: "PACKAGE_CLOSE", is_package: true, route_number: 1 });
      assert.deepEqual(ctx.stations, STATIONS);

      assert.deepEqual(ctx.kit, await A.getRouteFields(prisma, R.kit));
      assert.deepEqual(ctx.kit?.draft, KIT_DRAFT, "the kit's draft is in the payload");
      assert.ok(!("kit_missing" in ctx));
      assert.equal(ctx.item, null);
      assert.ok(!("item_missing" in ctx));

      assert.deepEqual(lineRows(ctx), KIT_LINES());
      const [alt, inBox, unrouted] = ctx.lines;
      assert.deepEqual(alt.route, await A.getRouteFields(prisma, R.alt));
      assert.deepEqual(inBox.route, await A.getRouteFields(prisma, R.inBox));
      assert.equal(inBox.route?.published_version, 1);
      assert.deepEqual(inBox.route?.published, IN_BOX_V1);
      for (const l of [alt, inBox]) assert.ok(!("missing" in l), `line ${l.line_id} has its route`);
      assert.equal(unrouted.route, null);
      assert.equal(unrouted.missing, C.ROUTE_MISSING);
      assert.equal(C.ROUTE_MISSING, "ROUTE_MISSING");

      // "משותף ל: …": IN_BOX's route runs in both kits' templates, IN_BOX_ALT's in this one only.
      assert.deepEqual(inBox.route?.shared_with, [
        { package_type_id: OTHER_KIT, desc: "PACKAGE" },
        { package_type_id: KIT, desc: "PACKAGE_CLOSE" },
      ]);
      assert.deepEqual(alt.route?.shared_with, [{ package_type_id: KIT, desc: "PACKAGE_CLOSE" }]);
      // The same route read from the other kit's context is the same payload.
      const other = await C.buildFieldsContext(prisma, { packageTypeId: OTHER_KIT, routeNumber: 1 });
      assert.deepEqual(other.lines.map((l) => [l.item_type_id, l.seq_from, l.seq_to]), [[H.ITEM_TYPE_IN_BOX, 1, 1]]);
      assert.deepEqual(other.lines[0].route, inBox.route);
    });

    it("package: a kit route number the kit does not have is kit null + kit_missing, while the lines keep their own route numbers; a kit without contents has no lines", async () => {
      const ctx = await C.buildFieldsContext(prisma, { packageTypeId: KIT, routeNumber: 2 });
      assert.equal(ctx.kind, "package");
      assert.deepEqual(ctx.subject, { item_type_id: KIT, desc: "PACKAGE_CLOSE", is_package: true, route_number: 2 });
      assert.equal(ctx.kit, null);
      assert.equal(ctx.kit_missing, C.ROUTE_MISSING);
      assert.equal(ctx.item, null);
      assert.ok(!("item_missing" in ctx));
      assert.deepEqual(lineRows(ctx), KIT_LINES());
      assert.deepEqual(ctx.lines.map((l) => l.route?.route.test_route_id ?? null), [R.alt, R.inBox, null]);

      const { stations, ...empty } = await C.buildFieldsContext(prisma, { packageTypeId: ITEM_TYPE_EMPTY_KIT, routeNumber: 1 });
      assert.deepEqual(empty, {
        kind: "package",
        subject: { item_type_id: ITEM_TYPE_EMPTY_KIT, desc: "EMPTY_KIT", is_package: true, route_number: 1 },
        kit: null,
        kit_missing: C.ROUTE_MISSING,
        item: null,
        lines: [],
      });
      assert.deepEqual(stations, STATIONS);
    });

    it("package: the seq ranges are exactly the package_seq a real createPackage gives a kit opened from the same template, laid out as the intake form does", async () => {
      // createPackage refuses a line without a route: draw UNROUTED's, the same shape as IN_BOX's.
      await H.q(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number)
         VALUES ($1, $2, ARRAY[$2::int, $3::int, $4::int], 1)`,
        [ITEM_TYPE_UNROUTED, H.TYPE_INTAKE, H.TYPE_FUNC, H.TYPE_CLOSE],
      );
      const ctx = await C.buildFieldsContext(prisma, { packageTypeId: KIT, routeNumber: 1 });

      // PackageIntakeDialog: one row per unit of each line, in the order the contents API lists them.
      const res = await getContents(new Request(`http://localhost/api/settings/item-types/${KIT}/contents`), {
        params: Promise.resolve({ id: String(KIT) }),
      });
      assert.equal(res.status, 200);
      const contents = (await res.json()) as { lines: { item_type_id: number; quantity: number }[] };
      const units = contents.lines.flatMap((l) => Array.from({ length: Math.max(1, l.quantity) }, () => l.item_type_id));
      const kit = await H.h().prisma.$transaction((tx: any) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID,
          shipment: H.SHIPMENT_ID,
          packageType: KIT,
          items: units.map((itemType, i) => ({ itemType, serialNumber: `SN-CTX-${i + 1}`, makat: "MK-1", model: "MODEL", manufacturer: "MFR" })),
        }),
      );

      const real = await H.q<{ item_type_id: number; seq_from: number; seq_to: number; n: number }>(
        `SELECT item_type_id, min(package_seq)::int AS seq_from, max(package_seq)::int AS seq_to, count(*)::int AS n
           FROM items WHERE package_id = $1
          GROUP BY item_type_id ORDER BY min(package_seq)`,
        [kit.packageId],
      );
      assert.deepEqual(
        ctx.lines.map((l) => ({ item_type_id: l.item_type_id, seq_from: l.seq_from, seq_to: l.seq_to, n: l.seq_to - l.seq_from + 1 })),
        real,
      );
      assert.deepEqual(real.map((r) => [r.item_type_id, r.seq_from, r.seq_to]), [
        [H.ITEM_TYPE_IN_BOX_ALT, 1, 1],
        [H.ITEM_TYPE_IN_BOX, 2, 3],
        [ITEM_TYPE_UNROUTED, 4, 6],
      ]);
    });

    // -------------------------------------------------------------------------------------
    // Item
    // -------------------------------------------------------------------------------------

    it("item: a single item route is the item member, with no kit and no lines; a route number the type does not have is item null + item_missing", async () => {
      const ctx = await C.buildFieldsContext(prisma, { itemTypeId: H.ITEM_TYPE_IN_BOX, routeNumber: 1 });
      assert.equal(ctx.kind, "item");
      assert.deepEqual(ctx.subject, { item_type_id: H.ITEM_TYPE_IN_BOX, desc: "IN_BOX", is_package: false, route_number: 1 });
      assert.deepEqual(ctx.stations, STATIONS);
      assert.deepEqual(ctx.item, await A.getRouteFields(prisma, R.inBox));
      assert.ok(!("item_missing" in ctx));
      assert.equal(ctx.kit, null);
      assert.ok(!("kit_missing" in ctx));
      assert.deepEqual(ctx.lines, []);

      const none = await C.buildFieldsContext(prisma, { itemTypeId: H.ITEM_TYPE_IN_BOX, routeNumber: 2 });
      assert.equal(none.kind, "item");
      assert.equal(none.subject.route_number, 2);
      assert.equal(none.item, null);
      assert.equal(none.item_missing, C.ROUTE_MISSING);
      assert.equal(none.kit, null);
      assert.ok(!("kit_missing" in none));
      assert.deepEqual(none.lines, []);
    });

    // -------------------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------------------

    it("errors: an unknown type is a 404; a kit asked as itemTypeId and a plain type asked as packageTypeId are 400s with their codes", async () => {
      const unknown = await rejectsAdmin(C.buildFieldsContext(prisma, { itemTypeId: 999, routeNumber: 1 }), 404, "ITEM_TYPE_NOT_FOUND");
      assert.deepEqual(unknown.extra, { item_type_id: 999 });
      await rejectsAdmin(C.buildFieldsContext(prisma, { packageTypeId: 999, routeNumber: 1 }), 404, "ITEM_TYPE_NOT_FOUND");
      const kitAsItem = await rejectsAdmin(C.buildFieldsContext(prisma, { itemTypeId: KIT, routeNumber: 1 }), 400, "IS_A_PACKAGE_TYPE");
      assert.deepEqual(kitAsItem.extra, { item_type_id: KIT });
      const itemAsKit = await rejectsAdmin(
        C.buildFieldsContext(prisma, { packageTypeId: H.ITEM_TYPE_IN_BOX, routeNumber: 1 }),
        400,
        "NOT_A_PACKAGE_TYPE",
      );
      assert.deepEqual(itemAsKit.extra, { item_type_id: H.ITEM_TYPE_IN_BOX });

      assert.deepEqual(await httpContext("itemTypeId=999&routeNumber=1"), {
        status: 404,
        body: { error: "Item type 999 not found", code: "ITEM_TYPE_NOT_FOUND", item_type_id: 999 },
      });
      const http = await httpContext(`itemTypeId=${KIT}&routeNumber=1`);
      assert.deepEqual([http.status, http.body.code, http.body.item_type_id], [400, "IS_A_PACKAGE_TYPE", KIT]);
    });

    it("errors: a query without exactly one of packageTypeId / itemTypeId, without routeNumber, or with a value that is not an int4 ≥ 1 is a 400 INVALID_QUERY", async () => {
      for (const qs of [
        "",
        "routeNumber=1",
        `packageTypeId=${KIT}&itemTypeId=${H.ITEM_TYPE_IN_BOX}&routeNumber=1`,
        `packageTypeId=${KIT}`,
        `packageTypeId=${KIT}&routeNumber=`,
        "packageTypeId=abc&routeNumber=1",
        "packageTypeId=0&routeNumber=1",
        "packageTypeId=3000000000&routeNumber=1",
        `itemTypeId=${H.ITEM_TYPE_IN_BOX}&routeNumber=-1`,
        `itemTypeId=${H.ITEM_TYPE_IN_BOX}&routeNumber=1.5`,
        `itemTypeId=${H.ITEM_TYPE_IN_BOX}&routeNumber=0`,
      ]) {
        const r = await httpContext(qs);
        assert.equal(r.status, 400, qs);
        assert.equal(r.body.code, "INVALID_QUERY", qs);
        assert.equal(typeof r.body.error, "string", qs);
      }
      // An empty parameter counts as absent, so the other one names the subject.
      assert.equal((await httpContext(`packageTypeId=${KIT}&itemTypeId=&routeNumber=1`)).status, 200);
    });

    it("errors: a stored config that does not parse — on the kit's route or on any line's — fails the whole read with a real 500, never a partial or empty context", async (t) => {
      // A 5xx is logged by the handler; keep it out of the test output, but make sure it happens.
      const logged = t.mock.method(console, "error", () => {});
      await H.q(`UPDATE testing_routes SET fields_draft = '{"schema": 9}'::jsonb WHERE test_route_id = $1`, [R.alt]);
      await rejectsAdmin(C.buildFieldsContext(prisma, { packageTypeId: KIT, routeNumber: 1 }), 500, "CONFIG_INVALID");
      const viaLine = await httpContext(`packageTypeId=${KIT}&routeNumber=1`);
      assert.equal(viaLine.status, 500);
      assert.deepEqual([viaLine.body.code, viaLine.body.route_id], ["CONFIG_INVALID", R.alt]);
      assert.ok(!("kind" in viaLine.body) && !("lines" in viaLine.body));

      await H.q("UPDATE testing_routes SET fields_draft = NULL WHERE test_route_id = $1", [R.alt]);
      await H.q(`UPDATE testing_routes SET fields_draft = '{"schema": 9}'::jsonb WHERE test_route_id = $1`, [R.kit]);
      const viaKit = await httpContext(`packageTypeId=${KIT}&routeNumber=1`);
      assert.deepEqual([viaKit.status, viaKit.body.code, viaKit.body.route_id], [500, "CONFIG_INVALID", R.kit]);
      assert.equal(logged.mock.callCount(), 2, "each 500 is logged");
    });

    // -------------------------------------------------------------------------------------
    // HTTP and the wire contract
    // -------------------------------------------------------------------------------------

    it("http: the handler answers exactly buildFieldsContext through JSON — dates as ISO strings — for both kinds, and the compiler holds the server type to FieldsContextJson", async () => {
      assert.equal(SERVER_MATCHES_WIRE, true);
      for (const [qs, query] of [
        [`packageTypeId=${KIT}&routeNumber=1`, { packageTypeId: KIT, routeNumber: 1 }],
        [`itemTypeId=${H.ITEM_TYPE_IN_BOX}&routeNumber=1`, { itemTypeId: H.ITEM_TYPE_IN_BOX, routeNumber: 1 }],
      ] as const) {
        const ctx = await C.buildFieldsContext(prisma, query);
        const res = await httpContext(qs);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const body = res.body as FieldsContextJson;
        assert.deepEqual(body, JSON.parse(JSON.stringify(ctx)), qs);
        assert.deepEqual(Object.keys(body.stations).map(Number).sort((a, b) => a - b), Object.keys(STATIONS).map(Number).sort((a, b) => a - b));
      }

      const body = (await httpContext(`packageTypeId=${KIT}&routeNumber=1`)).body as FieldsContextJson;
      const kitView = await A.getRouteFields(prisma, R.kit);
      assert.ok(kitView.draft_updated_at instanceof Date);
      assert.equal(body.kit?.draft_updated_at, kitView.draft_updated_at.toISOString());
      assert.equal(body.kit?.draft_updated_by, ACTOR.username);
      assert.deepEqual(body.lines.map((l) => [l.seq_from, l.seq_to, l.missing ?? null]), [[1, 1, null], [2, 3, null], [4, 6, "ROUTE_MISSING"]]);
    });
  },
);
