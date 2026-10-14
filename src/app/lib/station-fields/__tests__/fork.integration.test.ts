// Integration suite for "צור מסלול נפרד למארז הזה" — POST /api/settings/testing-routes/[id]/fork
// (route-fields spec §3.2.1, §8.8, §9.2 scenario י, decision 4; artboard 2), against a real
// database: the new route (number, steps, step uids, the copied draft), the one template line it
// moves, what it leaves alone (the source route, other kits, items already on the way), the next
// intake, the kit-shape check that rolls it back, and the handler's gate and error bodies.
//
// The rules live in fork.ts and most tests call forkRouteForKit directly. The handler is wrapped
// in withAuth, whose auth() needs a request scope a bare node:test process does not have; the HTTP
// test reaches it the way fields.integration.test.ts does — the root auth.ts is replaced in
// require.cache before anything loads it, with an auth() answering `session`.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database carrying the station-fields
// migration; without it the describe block is skipped. It borrows the write-path harness: setup()
// points DATABASE_URL at the scratch database before anything imports the Prisma client and holds
// the ledger suites' advisory lock for the life of this file; resetDb() wipes the operational
// tables before every test (testing_routes with CASCADE, so route_field_versions too).
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import type { AppRole } from "@/lib/auth/roles";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { AdminFieldsError } from "../admin";
import { FIELDS_EDIT_ROLES } from "../roles";
import type { Field, RouteFieldsConfig, StepConfig } from "../schema";

// ---------------------------------------------------------------------------
// Fixture. On top of the write-path world (station types 10 INTAKE and 40 CLOSE package-level,
// 20 FUNC per item; the kit PACKAGE_CLOSE = [INTAKE, CLOSE] with its items IN_BOX / IN_BOX_ALT =
// [INTAKE, FUNC, CLOSE]; the kit PACKAGE = [INTAKE]) this suite adds:
//   - a second route of IN_BOX (route 2), so the new number is max + 1 and not source + 1;
//   - a second kit OTHER_KIT = [INTAKE, CLOSE] whose template also runs IN_BOX's route 1;
//   - the templates: KIT runs IN_BOX ×2 and IN_BOX_ALT ×1 on route 1, OTHER_KIT IN_BOX ×1.
// ---------------------------------------------------------------------------

/** The kit on screen. */
const KIT = H.ITEM_TYPE_PACKAGE_CLOSE;
/** A second kit whose template runs IN_BOX's route 1 too — the "משותף ל:" of KIT's IN_BOX row. */
const OTHER_KIT = 31;
/** A kit IN_BOX's route does not fit: its route is [INTAKE] (it closes at INTAKE, not CLOSE). */
const MISFIT_KIT = H.ITEM_TYPE_PACKAGE;
/** A kit type without a well-formed route. */
const ROUTELESS_KIT = 32;

const UID = {
  kOpen: "s_kopen001", kClose: "s_kclose01",                         // KIT's route
  oOpen: "s_oopen001", oClose: "s_oclose01",                         // OTHER_KIT's route
  bOpen: "s_bopen001", bFunc: "s_bfunc001", bClose: "s_bclose01",    // IN_BOX route 1
  cOpen: "s_copen001", cFunc: "s_cfunc001", cClose: "s_cclose01",    // IN_BOX route 2
  aOpen: "s_aopen001", aFunc: "s_afunc001", aClose: "s_aclose01",    // IN_BOX_ALT route 1
} as const;
const IN_BOX_UIDS = [UID.bOpen, UID.bFunc, UID.bClose];
const ITEM_STEPS = [H.TYPE_INTAKE, H.TYPE_FUNC, H.TYPE_CLOSE];

/** test_route_id of each route, resolved after every reset. */
const R = { kit: 0, otherKit: 0, inBox: 0, inBox2: 0, alt: 0 };

const ACTOR = { username: "fork-suite", name: "Fork Suite" };

const LED: Field = {
  id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail",
  options: [
    { id: "o_led00001", label: "תקין", tone: "pass" },
    { id: "o_led00002", label: "לא דולקת", tone: "fail" },
  ],
};
const INSULATION: Field = { id: "f_ins00001", type: "pass_fail", label: "בדיקת בידוד", required: false, notes: "optional" };

const itemStep = (uid: string, fields: Field[]): StepConfig =>
  ({ uid, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item", groups: [{ target: "item", fields }] });
const config = (...steps: StepConfig[]): RouteFieldsConfig =>
  ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });

/** IN_BOX route 1's draft in the tests that give it one. */
const IN_BOX_DRAFT = config(itemStep(UID.bFunc, [LED, INSULATION]));
const IN_BOX_V1 = config(itemStep(UID.bFunc, [LED]));
const IN_BOX_V2 = config(itemStep(UID.bFunc, [INSULATION]));

// ---- the session withAuth sees -------------------------------------------------------------
/** What the stubbed auth() answers: null = signed out. Set by the HTTP test. */
let session: unknown = null;

const signedIn = (...roles: AppRole[]) => ({
  user: { preferredUsername: "fork-http", displayName: "Fork HTTP", name: "fork-http" },
  roles,
});

/** The root auth.ts, replaced in require.cache by a module whose auth() answers `session` (as
 *  fields.integration.test.ts does). Must run before anything loads auth.ts. */
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

describe(
  "station fields — fork: a kit's template line gets a route of its own",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — fork integration suite skipped" },
  () => {
    let A: typeof import("../admin");
    let C: typeof import("../context");
    let F: typeof import("../fork");
    let prisma: (typeof import("../../prisma"))["prisma"];
    let postFork: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    let serial = 0;

    before(async () => {
      // Before anything can load auth.ts.
      stubAuth();
      // MUST come next: it points DATABASE_URL at the scratch database before anything imports
      // the Prisma client, and takes the advisory lock.
      await H.setup();
      A = await import("../admin");
      C = await import("../context");
      F = await import("../fork");
      prisma = (await import("../../prisma")).prisma;
      postFork = (await import("../../../api/settings/testing-routes/[id]/fork/route")).POST as unknown as typeof postFork;
    });
    after(async () => {
      await H.teardown();
    });
    beforeEach(async () => {
      session = null;
      await H.resetDb();
      await H.q(
        `INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'OTHER_KIT', true), ($2, 'ROUTELESS_KIT', true)`,
        [OTHER_KIT, ROUTELESS_KIT],
      );
      R.kit = await giveUids(KIT, [UID.kOpen, UID.kClose]);
      R.inBox = await giveUids(H.ITEM_TYPE_IN_BOX, IN_BOX_UIDS);
      R.alt = await giveUids(H.ITEM_TYPE_IN_BOX_ALT, [UID.aOpen, UID.aFunc, UID.aClose]);
      R.otherKit = await insertRoute(OTHER_KIT, 1, [H.TYPE_INTAKE, H.TYPE_CLOSE], [UID.oOpen, UID.oClose]);
      R.inBox2 = await insertRoute(H.ITEM_TYPE_IN_BOX, 2, ITEM_STEPS, [UID.cOpen, UID.cFunc, UID.cClose]);
      await insertLine(KIT, H.ITEM_TYPE_IN_BOX, 2, 0);
      await insertLine(KIT, H.ITEM_TYPE_IN_BOX_ALT, 1, 1);
      await insertLine(OTHER_KIT, H.ITEM_TYPE_IN_BOX, 1, 0);
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

    async function insertRoute(itemTypeId: number, routeNumber: number, steps: number[], uids: string[]): Promise<number> {
      const row = await H.one<{ test_route_id: number }>(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number, step_uids)
         VALUES ($1, $2, $3::int[], $4, $5::text[]) RETURNING test_route_id`,
        [itemTypeId, steps[0], steps, routeNumber, uids],
      );
      return row.test_route_id;
    }

    async function insertLine(kit: number, itemTypeId: number, quantity: number, sortOrder: number, routeNumber = 1): Promise<void> {
      await H.q(
        `INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [kit, itemTypeId, quantity, routeNumber, sortOrder],
      );
    }

    type RouteRow = {
      test_route_id: number;
      item_type_id: number;
      test_station_type_id: number;
      route_number: number;
      route_steps: number[];
      step_uids: string[];
      fields_draft: unknown;
      draft_rev: number;
      draft_updated_at: Date | null;
      draft_updated_by: string | null;
      fields_version: number;
    };

    function routeRow(routeId: number): Promise<RouteRow> {
      return H.one<RouteRow>(
        `SELECT test_route_id, item_type_id, test_station_type_id, route_number, route_steps, step_uids, fields_draft,
                draft_rev, draft_updated_at, draft_updated_by, fields_version
           FROM testing_routes WHERE test_route_id = $1`,
        [routeId],
      );
    }

    /** Every route and every template line, whole — "nothing written" compares two of these. */
    async function footprint() {
      return {
        routes: await H.q("SELECT * FROM testing_routes ORDER BY test_route_id"),
        lines: await H.q("SELECT * FROM package_contents ORDER BY id"),
        versions: await H.q("SELECT * FROM route_field_versions ORDER BY id"),
        itemRoutes: await H.q("SELECT * FROM item_routes ORDER BY item_id"),
      };
    }

    /** [package_type_id, item_type_id, route_number] of every template line. */
    async function lineRoutes(): Promise<[number, number, number][]> {
      const rows = await H.q<{ k: number; t: number; r: number }>(
        "SELECT package_type_id AS k, item_type_id AS t, route_number AS r FROM package_contents ORDER BY package_type_id, item_type_id",
      );
      return rows.map((x) => [x.k, x.t, x.r]);
    }

    async function saveDraft(routeId: number, cfg: RouteFieldsConfig): Promise<number> {
      const { draft_rev } = await routeRow(routeId);
      return (await A.saveFieldsDraft(prisma, routeId, { config: cfg, base_rev: draft_rev }, ACTOR)).draft_rev;
    }

    /** Draft + publish of one route ("new_only"); returns the version it became. */
    async function publish(routeId: number, cfg: RouteFieldsConfig): Promise<number> {
      const rev = await saveDraft(routeId, cfg);
      const res = await A.publishFields(prisma, { route_ids: [routeId], base_revs: { [routeId]: rev }, apply_mode: "new_only" }, ACTOR);
      return res.versions[routeId];
    }

    function fork(routeId: number, packageTypeId: unknown) {
      return F.forkRouteForKit(prisma, routeId, { package_type_id: packageTypeId }, ACTOR);
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

    /** One kit of `kitType` holding `itemTypes`, taken in as the intake does (createPackage). */
    async function createKit(kitType: number, itemTypes: number[]): Promise<{ packageId: number; itemIds: number[] }> {
      return H.h().prisma.$transaction((tx: any) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID,
          shipment: H.SHIPMENT_ID,
          packageType: kitType,
          items: itemTypes.map((t) => ({
            itemType: t, serialNumber: `SN-FORK-${++serial}`, makat: "MK-1", model: "MODEL", manufacturer: "MFR",
          })),
        }),
      );
    }

    /** The route an item row runs and the version it froze. */
    async function itemRoute(itemId: number): Promise<{ route_number: number; fields_version: number | null }> {
      return H.one("SELECT route_number, fields_version FROM item_routes WHERE item_id = $1", [itemId]);
    }

    /** POST …/[id]/fork, invoked as Next would: a JSON body (or `raw` text), the params. */
    async function httpFork(id: string, opts: { body?: unknown; raw?: string }): Promise<{ status: number; body: any }> {
      const req = new Request(`http://localhost/api/settings/testing-routes/${id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: opts.raw ?? JSON.stringify(opts.body),
      });
      const res = await postFork(req, { params: Promise.resolve({ id }) });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    // -------------------------------------------------------------------------------------
    // The new route and the line it moves
    // -------------------------------------------------------------------------------------

    it("fork: the new route is max(route_number) + 1 of the item type, with the source's steps, first station type and SAME step uids; its draft is the source's draft (fields_version 0, draft_rev 0, by the actor); only this kit's line moves — the source route, the other kit's line and the kit's other line are untouched", async () => {
      await saveDraft(R.inBox, IN_BOX_DRAFT);
      const sourceBefore = await routeRow(R.inBox);
      const before = await footprint();

      const res = await fork(R.inBox, KIT);
      assert.equal(res.route_number, 3, "IN_BOX has routes 1 and 2: the next is 3, not source + 1");
      assert.ok(!before.routes.some((r: any) => r.test_route_id === res.test_route_id), "a new testing_routes row");
      assert.deepEqual(Object.keys(res).sort(), ["route_number", "test_route_id"]);

      const created = await routeRow(res.test_route_id);
      assert.equal(created.item_type_id, H.ITEM_TYPE_IN_BOX);
      assert.equal(created.route_number, 3);
      assert.deepEqual(created.route_steps, ITEM_STEPS);
      assert.deepEqual(created.step_uids, IN_BOX_UIDS, "the same uids: the config moves over as it is");
      assert.equal(created.test_station_type_id, H.TYPE_INTAKE);
      assert.deepEqual(created.fields_draft, IN_BOX_DRAFT);
      assert.equal(created.draft_rev, 0);
      assert.equal(created.fields_version, 0);
      assert.equal(created.draft_updated_by, ACTOR.username);
      assert.ok(created.draft_updated_at instanceof Date);

      // The source route as it was — its draft stays (the other kit still runs it).
      assert.deepEqual(await routeRow(R.inBox), sourceBefore);
      assert.deepEqual(await lineRoutes(), [
        [KIT, H.ITEM_TYPE_IN_BOX, 3],
        [KIT, H.ITEM_TYPE_IN_BOX_ALT, 1],
        [OTHER_KIT, H.ITEM_TYPE_IN_BOX, 1],
      ]);
      const after = await footprint();
      assert.deepEqual(after.routes.filter((r: any) => r.test_route_id !== res.test_route_id), before.routes, "no other route changed");
      assert.deepEqual(after.versions, before.versions, "no version is copied or touched");
      assert.deepEqual(after.itemRoutes, before.itemRoutes);

      // "משותף ל:" — the new route runs in this kit only; the old one in the other kit only.
      assert.deepEqual((await A.getRouteFields(prisma, res.test_route_id)).shared_with, [{ package_type_id: KIT, desc: "PACKAGE_CLOSE" }]);
      assert.deepEqual((await A.getRouteFields(prisma, R.inBox)).shared_with, [{ package_type_id: OTHER_KIT, desc: "OTHER_KIT" }]);
      // The kit's map now runs IN_BOX on the new route: its cells bind there, under the same uids.
      const ctx = await C.buildFieldsContext(prisma, { packageTypeId: KIT, routeNumber: 1 });
      const inBox = ctx.lines.find((l) => l.item_type_id === H.ITEM_TYPE_IN_BOX);
      assert.equal(inBox?.route_number, 3);
      assert.equal(inBox?.route?.route.test_route_id, res.test_route_id);
      assert.deepEqual(inBox?.route?.route.step_uids, IN_BOX_UIDS);
      assert.deepEqual(inBox?.route?.draft, IN_BOX_DRAFT);
      assert.deepEqual(inBox?.route?.issues, (await A.getRouteFields(prisma, R.inBox)).issues, "the same steps, the same draft: the same issues");
      assert.ok(!inBox?.route?.issues.some((i) => i.code === "STEP_UNKNOWN"), "every uid of the copied draft is a step of the new route");
      // The other kit's map is unchanged.
      const other = await C.buildFieldsContext(prisma, { packageTypeId: OTHER_KIT, routeNumber: 1 });
      assert.equal(other.lines[0].route?.route.test_route_id, R.inBox);
    });

    it("fork: without a draft the copy is the latest published config (the versions themselves stay with the source); a route with neither gets a SQL NULL draft and no draft author", async () => {
      assert.equal(await publish(R.inBox, IN_BOX_V1), 1);
      assert.equal(await publish(R.inBox, IN_BOX_V2), 2);
      assert.equal((await routeRow(R.inBox)).fields_draft, null);

      const res = await fork(R.inBox, KIT);
      const created = await routeRow(res.test_route_id);
      assert.deepEqual(created.fields_draft, IN_BOX_V2, "the latest version, not the first");
      assert.equal(created.fields_version, 0);
      assert.equal(created.draft_rev, 0);
      assert.deepEqual(await H.q("SELECT id FROM route_field_versions WHERE test_route_id = $1", [res.test_route_id]), []);
      const view = await A.getRouteFields(prisma, res.test_route_id);
      assert.deepEqual([view.draft, view.published, view.published_version], [IN_BOX_V2, null, 0]);
      const source = await routeRow(R.inBox);
      assert.deepEqual([source.fields_version, source.fields_draft], [2, null], "the source keeps its versions and no draft");

      // IN_BOX_ALT's route has no draft and was never published.
      const bare = await fork(R.alt, KIT);
      assert.equal(bare.route_number, 2);
      const row = await H.one(
        `SELECT fields_draft IS NULL AS sql_null, draft_updated_at, draft_updated_by, fields_version, step_uids
           FROM testing_routes WHERE test_route_id = $1`,
        [bare.test_route_id],
      );
      assert.deepEqual(row, { sql_null: true, draft_updated_at: null, draft_updated_by: null, fields_version: 0, step_uids: [UID.aOpen, UID.aFunc, UID.aClose] });
      assert.deepEqual(await lineRoutes(), [
        [KIT, H.ITEM_TYPE_IN_BOX, 3],
        [KIT, H.ITEM_TYPE_IN_BOX_ALT, 2],
        [OTHER_KIT, H.ITEM_TYPE_IN_BOX, 1],
      ]);
    });

    it("fork: two forks of one item type at once draw two numbers — the second waits for the first and takes the next", async () => {
      // OTHER_KIT runs IN_BOX's route 2, KIT its route 1: two forks with nothing to share but the type.
      await H.q("UPDATE package_contents SET route_number = 2 WHERE package_type_id = $1", [OTHER_KIT]);
      const [a, b] = await Promise.all([fork(R.inBox, KIT), fork(R.inBox2, OTHER_KIT)]);
      assert.deepEqual([a.route_number, b.route_number].sort(), [3, 4]);
      assert.deepEqual(await lineRoutes(), [
        [KIT, H.ITEM_TYPE_IN_BOX, a.route_number],
        [KIT, H.ITEM_TYPE_IN_BOX_ALT, 1],
        [OTHER_KIT, H.ITEM_TYPE_IN_BOX, b.route_number],
      ]);
      assert.deepEqual((await routeRow(b.test_route_id)).step_uids, [UID.cOpen, UID.cFunc, UID.cClose]);
    });

    // -------------------------------------------------------------------------------------
    // Items: on the way, and taken in after
    // -------------------------------------------------------------------------------------

    it("fork: rows already on the way keep their route and frozen version; the kit's next intake runs the new route (NULL until it is published, then its own version 1) while the other kit's intake keeps the old route", async () => {
      assert.equal(await publish(R.inBox, IN_BOX_V1), 1);
      const early = await createKit(KIT, [H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX]);
      for (const id of early.itemIds) assert.deepEqual(await itemRoute(id), { route_number: 1, fields_version: 1 });
      const itemRoutesBefore = (await footprint()).itemRoutes;

      const res = await fork(R.inBox, KIT);
      assert.deepEqual((await footprint()).itemRoutes, itemRoutesBefore, "no item_routes row changes");

      // Taken in after the fork: this kit's IN_BOX on the new route — never published, so the fixed popups.
      const next = await createKit(KIT, [H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await itemRoute(next.itemIds[0]), { route_number: res.route_number, fields_version: null });
      // The other kit still runs route 1, at its version.
      const other = await createKit(OTHER_KIT, [H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await itemRoute(other.itemIds[0]), { route_number: 1, fields_version: 1 });

      // The copied draft publishes as the new route's version 1, and the next intake freezes it.
      const published = await A.publishFields(prisma, { route_ids: [res.test_route_id], base_revs: { [res.test_route_id]: 0 }, apply_mode: "new_only" }, ACTOR);
      assert.deepEqual(published.versions, { [res.test_route_id]: 1 });
      const later = await createKit(KIT, [H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await itemRoute(later.itemIds[0]), { route_number: res.route_number, fields_version: 1 });
      assert.deepEqual(await itemRoute(next.itemIds[0]), { route_number: res.route_number, fields_version: null }, "rows keep what they froze");
      for (const id of early.itemIds) assert.deepEqual(await itemRoute(id), { route_number: 1, fields_version: 1 });
    });

    // -------------------------------------------------------------------------------------
    // The kit-shape check and the refusals
    // -------------------------------------------------------------------------------------

    it("fork: a new route that does not fit the kit's route is a 409 ITEM_ROUTE_SHAPE with the intake's reason, a kit without a well-formed route a 409 PACKAGE_ROUTE_SHAPE — and the fork rolls back whole", async () => {
      await insertLine(MISFIT_KIT, H.ITEM_TYPE_IN_BOX, 1, 0);
      await insertLine(ROUTELESS_KIT, H.ITEM_TYPE_IN_BOX, 1, 0);
      await saveDraft(R.inBox, IN_BOX_DRAFT);
      const before = await footprint();

      const misfit = await rejectsAdmin(fork(R.inBox, MISFIT_KIT), 409, "ITEM_ROUTE_SHAPE");
      assert.deepEqual(misfit.extra, { reason: "IN_BOX: מסלול הפריט חייב להסתיים באותה עמדת סגירה כמו מסלול המארז", package_route_number: 1 });
      const routeless = await rejectsAdmin(fork(R.inBox, ROUTELESS_KIT), 409, "PACKAGE_ROUTE_SHAPE");
      assert.deepEqual(routeless.extra, { reason: "לסוג המארז עדיין אין מסלול" });
      // A kit route that is itself malformed (no package-level opening) is no route to check against.
      await insertRoute(ROUTELESS_KIT, 1, [H.TYPE_FUNC], ["s_rlss0001"]);
      const malformed = await rejectsAdmin(fork(R.inBox, ROUTELESS_KIT), 409, "PACKAGE_ROUTE_SHAPE");
      assert.deepEqual(malformed.extra, { reason: "השלב הראשון של מסלול המארז חייב להיות עמדה ברמת מארז (פתיחת מארז)" });
      await H.q("DELETE FROM testing_routes WHERE item_type_id = $1", [ROUTELESS_KIT]);

      assert.deepEqual(await footprint(), before, "no route created, no line moved");
      // Nothing of the refused forks remains: the next fork still draws 3.
      assert.equal((await fork(R.inBox, KIT)).route_number, 3);
    });

    it("fork: refusals — a bad route id 400 INVALID_ID, a bad package_type_id 400 INVALID_BODY, a missing route or kit 404, a type that is not a kit 400, a kit without a line for the item type 400 KIT_LINE_NOT_FOUND, a line on another route of the type 409 LINE_NOT_ON_ROUTE (a second click on a stale screen too) — none writes", async () => {
      const BIG = 2 ** 31;
      const MAX = BIG - 1;
      const before = await footprint();

      for (const id of [0, -1, BIG, Number.NaN]) await rejectsAdmin(fork(id, KIT), 400, "INVALID_ID");
      for (const bad of [undefined, null, "5", 0, 1.5, BIG]) await rejectsAdmin(fork(R.inBox, bad), 400, "INVALID_BODY");
      await rejectsAdmin(F.forkRouteForKit(prisma, R.inBox, [] as never, ACTOR), 400, "INVALID_BODY");

      const noRoute = await rejectsAdmin(fork(MAX, KIT), 404, "ROUTE_NOT_FOUND");
      assert.deepEqual(noRoute.extra, { route_id: MAX });
      const noKit = await rejectsAdmin(fork(R.inBox, 999), 404, "ITEM_TYPE_NOT_FOUND");
      assert.deepEqual(noKit.extra, { item_type_id: 999 });
      const notKit = await rejectsAdmin(fork(R.inBox, H.ITEM_TYPE_IN_BOX_ALT), 400, "NOT_A_PACKAGE_TYPE");
      assert.deepEqual(notKit.extra, { item_type_id: H.ITEM_TYPE_IN_BOX_ALT });
      const noLine = await rejectsAdmin(fork(R.alt, OTHER_KIT), 400, "KIT_LINE_NOT_FOUND");
      assert.deepEqual(noLine.extra, { package_type_id: OTHER_KIT, item_type_id: H.ITEM_TYPE_IN_BOX_ALT });
      // KIT's IN_BOX line runs route 1, not route 2.
      const otherRoute = await rejectsAdmin(fork(R.inBox2, KIT), 409, "LINE_NOT_ON_ROUTE");
      assert.deepEqual(otherRoute.extra, { package_type_id: KIT, item_type_id: H.ITEM_TYPE_IN_BOX, route_number: 1 });
      assert.deepEqual(await footprint(), before, "nothing written");

      // The same request twice (a double click, or a second tab): the first fork moved the line.
      const first = await fork(R.inBox, KIT);
      const again = await rejectsAdmin(fork(R.inBox, KIT), 409, "LINE_NOT_ON_ROUTE");
      assert.deepEqual(again.extra, { package_type_id: KIT, item_type_id: H.ITEM_TYPE_IN_BOX, route_number: first.route_number });
      assert.deepEqual(
        (await H.q<{ n: number }>("SELECT route_number AS n FROM testing_routes WHERE item_type_id = $1 ORDER BY 1", [H.ITEM_TYPE_IN_BOX])).map((r) => r.n),
        [1, 2, 3],
        "one new route, not two",
      );
    });

    // -------------------------------------------------------------------------------------
    // HTTP
    // -------------------------------------------------------------------------------------

    it("http: POST …/[id]/fork needs a session (401) and FIELDS_EDIT_ROLES (403) and writes nothing when refused; a tester's fork answers 201 {test_route_id, route_number} and records the session as the draft's author; refusals carry status, code and extra", async () => {
      await saveDraft(R.inBox, IN_BOX_DRAFT);
      const id = String(R.inBox);
      const before = await footprint();

      session = null;
      assert.deepEqual(await httpFork(id, { body: { package_type_id: KIT } }), { status: 401, body: { error: "Unauthorized" } });
      session = signedIn("storekeeper", "mashan");
      assert.deepEqual(await httpFork(id, { body: { package_type_id: KIT } }), { status: 403, body: { error: "Forbidden", required: FIELDS_EDIT_ROLES } });
      assert.deepEqual(await footprint(), before, "nothing written");

      session = signedIn("tester");
      const notJson = await httpFork(id, { raw: "{not json" });
      assert.deepEqual([notJson.status, notJson.body.code], [400, "INVALID_BODY"]);
      for (const bad of ["abc", "0", "3000000000"]) {
        const r = await httpFork(bad, { body: { package_type_id: KIT } });
        assert.deepEqual([r.status, r.body.code], [400, "INVALID_ID"], bad);
      }

      const created = await httpFork(id, { body: { package_type_id: KIT } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.deepEqual(Object.keys(created.body).sort(), ["route_number", "test_route_id"]);
      assert.equal(created.body.route_number, 3);
      const row = await routeRow(created.body.test_route_id);
      assert.equal(row.draft_updated_by, "fork-http", "the session's preferredUsername");
      assert.deepEqual(row.fields_draft, IN_BOX_DRAFT);

      const stale = await httpFork(id, { body: { package_type_id: KIT } });
      assert.equal(stale.status, 409);
      assert.deepEqual(
        { ...stale.body, error: typeof stale.body.error },
        { error: "string", code: "LINE_NOT_ON_ROUTE", package_type_id: KIT, item_type_id: H.ITEM_TYPE_IN_BOX, route_number: 3 },
      );
      await insertLine(MISFIT_KIT, H.ITEM_TYPE_IN_BOX, 1, 0);
      const shape = await httpFork(id, { body: { package_type_id: MISFIT_KIT } });
      assert.deepEqual([shape.status, shape.body.code, shape.body.reason, shape.body.package_route_number], [
        409, "ITEM_ROUTE_SHAPE", "IN_BOX: מסלול הפריט חייב להסתיים באותה עמדת סגירה כמו מסלול המארז", 1,
      ]);
      const gone = await httpFork("2147483647", { body: { package_type_id: KIT } });
      assert.deepEqual(gone, { status: 404, body: { error: "Route 2147483647 not found", code: "ROUTE_NOT_FOUND", route_id: 2147483647 } });
    });
  },
);
