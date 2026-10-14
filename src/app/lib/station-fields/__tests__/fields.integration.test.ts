// Integration suite for station fields, phase 1a (route-fields spec §1.5, §3.1–§3.5; acceptance
// §8.1, §8.4–§8.8), against a real database:
//   - routes: step uids kept, minted and refused when a route's steps are saved (§3.5);
//   - drafts: autosave and discard (§3.4.1);
//   - publish: preview, versions, apply_mode and the "מולא ב-N בדיקות" counts (§3.4.2, §3.4.3);
//   - freeze: the version a row takes at intake, retype and box reset (§1.5);
//   - GET /api/testing/station-fields: what a popup is built from (§3.3);
//   - POST /api/testing/results: what a submit stores, or why it is refused (§3.4);
//   - HTTP: the admin handlers' role gates and error bodies (§3.0, §3.2).
//
// The rules of the admin writes live in the lib functions their handlers call (route-steps.ts,
// admin.ts), and most tests drive those directly. The handlers themselves are wrapped in
// withAuth, whose auth() needs a request scope a bare node:test process does not have; the HTTP
// tests reach them the way read-path.integration.test.ts does — the root auth.ts is replaced in
// require.cache before anything loads it, with an auth() answering `session` — so withAuth's own
// role check runs for real. The /api/testing handlers are not wrapped (the middleware gates them,
// src/lib/routes.ts) and are invoked for real throughout.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database carrying the station-fields
// migration; without it the describe block is skipped. It borrows the write-path harness:
// setup() points DATABASE_URL at the scratch database before anything imports the Prisma client
// and holds the ledger suites' advisory lock for the life of this file; resetDb() wipes the
// operational tables before every test (testing_routes with CASCADE, so route_field_versions
// too). option_lists and field_sets survive a reset, and this suite never writes them.
import { after, before, beforeEach, describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { AppRole } from "@/lib/auth/roles";
import type { TransactionClient } from "../../prisma";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { AdminFieldsError, RouteIssue } from "../admin";
import type { RouteStepsError } from "../route-steps";
import { GATE_FINISH_ON_REQUIRED } from "../evaluate";
import { UNDRAWN_TEXT, KIT_ROUTE_LABEL, fieldsGateText, routeOfTypeLabel } from "../labels";
import { FIELDS_EDIT_ROLES, PUBLISH_ROLES } from "../roles";
import { ID_PATTERNS } from "../schema";
import type { ChoiceOption, ChoiceRowField, Field, FieldGroup, RouteFieldsConfig, StepConfig, Tone } from "../schema";

// ---------------------------------------------------------------------------
// Fixture. On top of the write-path world (station types 10 INTAKE and 40 CLOSE package-level,
// 20 FUNC and 30 RESEARCH per item; item types 1–7 with one route each, the kit PACKAGE_CLOSE
// = [INTAKE, CLOSE] and its items IN_BOX / IN_BOX_ALT = [INTAKE, FUNC, CLOSE]) this suite adds
// three plain item types. The write-path fixture inserts its routes WITHOUT step uids (readers
// then answer legacy), so beforeEach gives every route the suite reads known ones.
// ---------------------------------------------------------------------------

/** Plain item type, route 1 = [FUNC, FUNC, FUNC]: the item-mode route. */
const ITEM_TYPE_FIELDS = 11;
/** Plain item type, route 1 = [FUNC]: a second route for batches. */
const ITEM_TYPE_SECOND = 12;
/** Plain item type without a route: the routes tests build theirs. */
const ITEM_TYPE_ROUTED = 13;

const UID = {
  f1: "s_fld00001", f2: "s_fld00002", f3: "s_fld00003",              // FIELDS route
  s1: "s_snd00001",                                                  // SECOND route
  kOpen: "s_kopen001", kClose: "s_kclose01",                         // the kit's route
  bOpen: "s_bopen001", bFunc: "s_bfunc001", bClose: "s_bclose01",    // IN_BOX
  aOpen: "s_aopen001", aFunc: "s_afunc001", aClose: "s_aclose01",    // IN_BOX_ALT
} as const;

/** test_route_id of each route, resolved after every reset. */
const R = { fields: 0, second: 0, kit: 0, inBox: 0, alt: 0 };

/** Who writes drafts and publishes (draft_updated_by / published_by / published_by_name). */
const ACTOR = { username: "fields-suite", name: "Fields Suite" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- fields -------------------------------------------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED_OPTIONS = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const EXT_OPTIONS = [opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שריטות קלות", "warn"), opt("o_ext00003", "שבר/סדק", "fail"), opt("o_ext00004", "לכלוך", "warn")];
const PART_OPTIONS = [opt("o_prt00001", "קיים", "pass"), opt("o_prt00002", "חסר", "fail"), opt("o_prt00003", "פגום", "fail"), opt("o_prt00004", "הוחלף", "warn")];

const SECTION: Field = { id: "f_sec00001", type: "section", label: "הפעלה" };
/** note_max 500 — the explicit maximum. */
const LED: ChoiceRowField = { id: "f_led00001", type: "choice_row", label: "נורית מתח", required: true, notes: "required_on_fail", note_max: 500, options: LED_OPTIONS };
/** No note_max — the default 1000 applies. */
const GND: Field = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const INSULATION: Field = { id: "f_ins00001", type: "pass_fail", label: "בדיקת בידוד", required: false, notes: "optional" };
const INTAKE_NOTE: Field = { id: "f_tag00001", type: "text", label: "הערת קליטה", required: false, notes: "off" };
const BOX_FIELD: ChoiceRowField = { id: "f_box00001", type: "choice_row", label: "שלמות הקופסה", required: true, notes: "required_on_fail", options: EXT_OPTIONS };
const EXT_FIELD: ChoiceRowField = { id: "f_ext00001", type: "choice_row", label: "מצב חיצוני", required: true, notes: "required_on_fail", options: EXT_OPTIONS };
const STAND: ChoiceRowField = { id: "f_stand001", type: "choice_row", label: "מעמד", required: true, notes: "optional", options: PART_OPTIONS };
const CABLE: ChoiceRowField = { id: "f_cable001", type: "choice_row", label: "כבל DisplayPort", required: true, notes: "optional", options: PART_OPTIONS };
const SEAL: Field = { id: "f_seal0001", type: "pass_fail", label: "מדבקת סגירה", required: true, notes: "optional" };

// ---- configs ------------------------------------------------------------------------------
/** A per-item step on a FUNC station. */
const itemStep = (uid: string, fields: Field[]): StepConfig =>
  ({ uid, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item", groups: [{ target: "item", fields }] });
/** A package-level step (INTAKE / CLOSE). */
const kitStep = (uid: string, typeId: number, label: string, groups: FieldGroup[]): StepConfig =>
  ({ uid, station_type_id: typeId, station_label: label, scope: "package", groups });
const config = (...steps: StepConfig[]): RouteFieldsConfig =>
  ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });

/** Version 1 of the FIELDS route in the results tests: fields at its first step only. */
const ITEM_CONFIG = config(itemStep(UID.f1, [SECTION, LED, GND, INSULATION, INTAKE_NOTE]));
const itemSchema = () => ({ route_id: R.fields, v: 1, step_uid: UID.f1, target: "item" });

// ---- values as a popup sends them, and as the server stores them ------------------------
const withNote = (note: string | undefined) => (note !== undefined ? { note } : {});
const choice = (opt: string | null, note?: string) => ({ t: "choice_row", opt, ...withNote(note) });
const num = (value: number | null, note?: string) => ({ t: "number", value, ...withNote(note) });
/** Both required fields of ITEM_CONFIG, filled and passing. */
const validFields = () => ({ [LED.id]: choice("o_led00001"), [GND.id]: num(0.05) });

/** A choice value as stored: label, option label and tone copied from the definition. */
function storedChoice(field: ChoiceRowField, optId: string, note?: string) {
  const o = field.options.find((x) => x.id === optId);
  assert.ok(o, `${optId} is not an option of ${field.id}`);
  return { t: "choice_row", label: field.label, opt: o.id, opt_label: o.label, tone: o.tone, ...withNote(note) };
}

// ---- step uid draws ------------------------------------------------------------------------
/** step-uids.ts's alphabet, as step-uids.test.ts spells it. */
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Scripts the next step-uid mints: each 16-byte draw step-uids.ts makes through
 * crypto.getRandomValues spells the next suffix; every other caller (Prisma's ids, pg's nonces —
 * other sizes) and every draw after the script runs out gets real randomness. Restored when the
 * test ends. Returns how many scripted draws are left.
 */
function scriptUidDraws(t: TestContext, suffixes: string[]): () => number {
  const queue = [...suffixes];
  const webCrypto = globalThis.crypto;
  const real = webCrypto.getRandomValues.bind(webCrypto);
  t.mock.method(webCrypto, "getRandomValues", (array: any) => {
    if (array instanceof Uint8Array && !Buffer.isBuffer(array) && array.length === 16 && queue.length > 0) {
      const word = queue.shift()!;
      array.fill(255);   // rejected bytes: only the spelled ones count
      [...word].forEach((ch, i) => { array[i] = ALPHABET.indexOf(ch); });
      return array;
    }
    return real(array);
  });
  return () => queue.length;
}

// ---- the session withAuth sees -------------------------------------------------------------
/** What the stubbed auth() answers: null = signed out. Set by the HTTP tests. */
let session: unknown = null;

/** A signed-in user with these roles; the names land in draft_updated_by / published_by(_name). */
const signedIn = (...roles: AppRole[]) => ({
  user: { preferredUsername: "fields-http", displayName: "Fields HTTP", name: "fields-http" },
  roles,
});

/**
 * Replaces the root auth.ts in require.cache with a module whose auth() answers `session`, as
 * read-path.integration.test.ts does. Must run before anything loads auth.ts (withAuth imports
 * it): tsx loads this suite and the route modules as CommonJS, so the cache entry is what every
 * later require of auth.ts gets.
 */
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
  "station fields — routes, drafts, publish, freeze, worker read and result write",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — station-fields integration suite skipped" },
  () => {
    let A: typeof import("../admin");
    let RS: typeof import("../route-steps");
    let S: typeof import("../submit");
    let prisma: (typeof import("../../prisma"))["prisma"];
    let getStationFields: (req: Request) => Promise<Response>;
    /** The admin route handlers, as Next runs them (withAuth included). */
    let http: {
      routes: typeof import("../../../api/settings/testing-routes/route");
      route: typeof import("../../../api/settings/testing-routes/[id]/route");
      fields: typeof import("../../../api/settings/testing-routes/[id]/fields/route");
      draft: typeof import("../../../api/settings/testing-routes/[id]/fields/draft/route");
      preview: typeof import("../../../api/settings/testing-routes/fields/publish-preview/route");
      publish: typeof import("../../../api/settings/testing-routes/fields/publish/route");
    };

    before(async () => {
      // Before anything can load auth.ts.
      stubAuth();
      // MUST come next: it points DATABASE_URL at the scratch database before anything imports
      // the Prisma client, and takes the advisory lock.
      await H.setup();
      A = await import("../admin");
      RS = await import("../route-steps");
      S = await import("../submit");
      prisma = (await import("../../prisma")).prisma;
      getStationFields = (await import("../../../api/testing/station-fields/route")).GET;
      http = {
        routes: await import("../../../api/settings/testing-routes/route"),
        route: await import("../../../api/settings/testing-routes/[id]/route"),
        fields: await import("../../../api/settings/testing-routes/[id]/fields/route"),
        draft: await import("../../../api/settings/testing-routes/[id]/fields/draft/route"),
        preview: await import("../../../api/settings/testing-routes/fields/publish-preview/route"),
        publish: await import("../../../api/settings/testing-routes/fields/publish/route"),
      };
    });
    after(async () => {
      await H.teardown();
    });
    beforeEach(async () => {
      session = null;
      await H.resetDb();
      await H.q(
        `INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES
           ($1, 'FIELDS', false), ($2, 'SECOND', false), ($3, 'ROUTED', false)`,
        [ITEM_TYPE_FIELDS, ITEM_TYPE_SECOND, ITEM_TYPE_ROUTED],
      );
      R.fields = await insertRoute(ITEM_TYPE_FIELDS, [H.TYPE_FUNC, H.TYPE_FUNC, H.TYPE_FUNC], [UID.f1, UID.f2, UID.f3]);
      R.second = await insertRoute(ITEM_TYPE_SECOND, [H.TYPE_FUNC], [UID.s1]);
      R.kit = await giveUids(H.ITEM_TYPE_PACKAGE_CLOSE, [UID.kOpen, UID.kClose]);
      R.inBox = await giveUids(H.ITEM_TYPE_IN_BOX, [UID.bOpen, UID.bFunc, UID.bClose]);
      R.alt = await giveUids(H.ITEM_TYPE_IN_BOX_ALT, [UID.aOpen, UID.aFunc, UID.aClose]);
    });

    // -------------------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------------------

    async function insertRoute(itemTypeId: number, steps: number[], uids: string[]): Promise<number> {
      const row = await H.one<{ test_route_id: number }>(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number, step_uids)
         VALUES ($1, $2, $3::int[], 1, $4::text[]) RETURNING test_route_id`,
        [itemTypeId, steps[0], steps, uids],
      );
      return row.test_route_id;
    }

    async function giveUids(itemTypeId: number, uids: string[]): Promise<number> {
      const row = await H.one<{ test_route_id: number }>(
        `UPDATE testing_routes SET step_uids = $2::text[]
          WHERE item_type_id = $1 AND route_number = 1 RETURNING test_route_id`,
        [itemTypeId, uids],
      );
      return row.test_route_id;
    }

    type RouteRow = {
      route_steps: number[];
      step_uids: string[];
      test_station_type_id: number;
      fields_draft: unknown;
      draft_rev: number;
      draft_updated_at: Date | null;
      draft_updated_by: string | null;
      fields_version: number;
    };

    function routeRow(routeId: number): Promise<RouteRow> {
      return H.one<RouteRow>(
        `SELECT route_steps, step_uids, test_station_type_id, fields_draft, draft_rev, draft_updated_at,
                draft_updated_by, fields_version
           FROM testing_routes WHERE test_route_id = $1`,
        [routeId],
      );
    }

    /** PUT /api/settings/testing-routes/[id]'s work, in its own transaction as the handler runs it. */
    function saveRoute(routeId: number, body: Record<string, unknown>) {
      return prisma.$transaction((tx) => RS.saveRouteSteps(tx, routeId, body, ACTOR.username));
    }

    /** Autosave against the current draft_rev; returns the new one. */
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

    async function rejectsRouteSteps(p: Promise<unknown>, status: number, code: string): Promise<RouteStepsError> {
      try {
        await p;
      } catch (e) {
        assert.ok(e instanceof RS.RouteStepsError, `expected RouteStepsError, got ${String(e)}`);
        assert.equal(e.status, status, e.message);
        assert.equal(e.code, code);
        assert.deepEqual(e.body, { error: e.message, code });
        return e;
      }
      assert.fail(`expected ${status} ${code}, got success`);
    }

    /** A plain item queued at step 1 of `itemTypeId`'s route, frozen at `version` — what intake
     *  writes (§1.5); plain items have no intake path of their own in the package model. */
    async function seedFrozenItem(itemId: number, version: number | null, itemTypeId = ITEM_TYPE_FIELDS): Promise<void> {
      await H.seedItem({ itemId, itemTypeId, stationId: H.STATION_FUNC_A });
      await H.q("UPDATE item_routes SET fields_version = $2 WHERE item_id = $1", [itemId, version]);
    }

    async function versionOf(itemId: number): Promise<number | null> {
      return (await H.one<{ v: number | null }>("SELECT fields_version AS v FROM item_routes WHERE item_id = $1", [itemId])).v;
    }

    async function createKit(itemTypes: number[]): Promise<{ packageId: number; itemIds: number[] }> {
      return H.h().prisma.$transaction((tx: any) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID,
          shipment: H.SHIPMENT_ID,
          packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
          items: itemTypes.map((t, i) => ({
            itemType: t, serialNumber: `SN-KIT-${i + 1}`, makat: "MK-1", model: "MODEL", manufacturer: "MFR",
          })),
        }),
      );
    }

    async function addKitItem(packageId: number, itemType: number, serialNumber: string): Promise<number> {
      const added = await H.h().prisma.$transaction((tx: any) =>
        H.h().addPackageItem(tx, BigInt(packageId), { itemType, serialNumber, makat: "MK-1", model: "MODEL", manufacturer: "MFR" }),
      );
      return added.itemId;
    }

    /** The opening as today's wizard does it when the step has no fields: group start, then one
     *  result per item and the box. */
    async function openKit(kit: { packageId: number; itemIds: number[] }): Promise<void> {
      await H.startTest({ itemId: kit.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
      const submitId = randomUUID();
      for (const id of [...kit.itemIds, kit.packageId]) {
        const r = await H.submitResult({ ItemID: id, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true });
        assert.equal(r.status, 200, `opening ${id}: ${JSON.stringify(r.body)}`);
      }
    }

    /** An item through a per-item step: started at `stationId` and passed. */
    async function passStep(itemId: number, stationId: number): Promise<void> {
      await H.startTest({ itemId, stationId, actionUuid: randomUUID() });
      const r = await H.submitResult({ ItemID: itemId, StationID: stationId, SubmitID: randomUUID(), Passed: true });
      assert.equal(r.status, 200, `step of ${itemId}: ${JSON.stringify(r.body)}`);
    }

    /** An item that leaves its route before the closing step: sent to research from `stationId`
     *  and finished there. */
    async function finishThroughResearch(itemId: number, stationId: number): Promise<void> {
      await H.startTest({ itemId, stationId, actionUuid: randomUUID() });
      const sent = await H.submitResult({ ItemID: itemId, StationID: stationId, SubmitID: randomUUID(), sendToResearch: true });
      assert.equal(sent.status, 200, `research of ${itemId}: ${JSON.stringify(sent.body)}`);
      await H.startTest({ itemId, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });
      const done = await H.submitResult({ ItemID: itemId, StationID: H.STATION_RESEARCH, SubmitID: randomUUID(), finishRoute: true });
      assert.equal(done.status, 200, `finish of ${itemId}: ${JSON.stringify(done.body)}`);
      assert.equal((await H.routeRow(itemId)).is_finished, true);
    }

    /** GET /api/testing/station-fields, invoked as Next would. */
    async function stationFields(itemId: number | string, stationId?: number): Promise<{ status: number; body: any }> {
      const qs = `itemId=${itemId}` + (stationId !== undefined ? `&stationId=${stationId}` : "");
      const res = await getStationFields(new Request(`http://localhost/api/testing/station-fields?${qs}`));
      return { status: res.status, body: await res.json() };
    }

    /** POST /api/testing/results with a fresh SubmitID. */
    function submitAt(itemId: number, stationId: number, extra: Record<string, unknown>) {
      return H.submitResult({ ItemID: itemId, StationID: stationId, SubmitID: randomUUID(), ...extra });
    }

    type StoredResult = { result: number | null; passed: boolean | null; comments: string | null; details: any };
    function storedResults(itemId: number): Promise<StoredResult[]> {
      return H.q<StoredResult>(
        "SELECT result, passed, comments, details FROM test_results WHERE item_id = $1 ORDER BY test_result_id",
        [itemId],
      );
    }

    /** Everything a submit could have written for an item: "nothing written" compares two of these. */
    async function footprint(itemId: number) {
      const count = async (sql: string) => (await H.q(sql, [itemId])).length;
      return {
        route: await H.one("SELECT * FROM item_routes WHERE item_id = $1", [itemId]),
        results: await count("SELECT 1 FROM test_results WHERE item_id = $1"),
        history: await count("SELECT 1 FROM item_route_history WHERE item_id = $1"),
        research: await count("SELECT 1 FROM research_history WHERE item_id = $1"),
        events: (await H.events(itemId)).length,
      };
    }

    /** One admin handler call as Next makes it: a JSON body (or `raw` text), the dynamic route's
     *  params, the body of the answer parsed. */
    async function httpCall(
      handler: unknown,
      method: string,
      url: string,
      opts: { body?: unknown; raw?: string; params?: Record<string, string> } = {},
    ): Promise<{ status: number; body: any }> {
      const req = new Request(`http://localhost${url}`, {
        method,
        headers: { "content-type": "application/json" },
        body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      });
      const call = handler as (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
      const res = await call(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    }

    /**
     * publishFields' client, recording for every "מולא ב-N בדיקות" scan (a test_results query)
     * whether its transaction already holds a write lock on item_routes at that moment — asked on
     * the same transaction, just before the scan runs.
     */
    function lockProbe(heldDuringScan: boolean[]): PrismaClient {
      type Tx = TransactionClient;
      const probed = (tx: Tx): Tx => new Proxy(tx, {
        get(target, prop) {
          const value = Reflect.get(target, prop);
          if (prop !== "$queryRaw") return typeof value === "function" ? value.bind(target) : value;
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join("?").includes("FROM test_results")) {
              const [row] = await target.$queryRaw<{ held: boolean }[]>`
                SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
                                WHERE c.relname = 'item_routes' AND l.pid = pg_backend_pid()
                                  AND l.mode = 'RowExclusiveLock') AS held`;
              heldDuringScan.push(row.held);
            }
            return target.$queryRaw(strings, ...values);
          };
        },
      });
      return {
        $transaction: (fn: (tx: Tx) => Promise<unknown>, options?: Parameters<typeof prisma.$transaction>[1]) =>
          prisma.$transaction((tx) => fn(probed(tx)), options),
      } as unknown as PrismaClient;
    }

    // -------------------------------------------------------------------------------------
    // Routes: step uids (§3.5) — route-steps.ts, as POST / PUT /api/settings/testing-routes run it
    // -------------------------------------------------------------------------------------

    it("routes: POST mints a fresh uid per step; re-saving steps without step_uids keeps each uid by (type, occurrence), a type twice included; test_station_type_id follows the first step", async () => {
      const created = await RS.createRoute(prisma, {
        item_type_id: ITEM_TYPE_ROUTED,
        route_number: 1,
        route_steps: [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC],
        step_uids: ["s_ignored0", null, null],   // a new route has no uids to keep
      });
      assert.deepEqual(created.route_steps, [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC]);
      assert.equal(created.test_station_type_id, H.TYPE_FUNC);
      assert.equal(created.step_uids.length, 3);
      for (const uid of created.step_uids) assert.match(uid, ID_PATTERNS.step);
      assert.equal(new Set(created.step_uids).size, 3);
      assert.ok(!created.step_uids.includes("s_ignored0"));
      const [u1, u2, u3] = created.step_uids;
      const routeId = created.test_route_id;
      assert.deepEqual((await routeRow(routeId)).step_uids, [u1, u2, u3]);
      assert.deepEqual(await RS.listRoutes(prisma, { itemTypeId: ITEM_TYPE_ROUTED, routeNumber: 1 }), [{
        test_route_id: routeId, item_type_id: ITEM_TYPE_ROUTED, test_station_type_id: H.TYPE_FUNC, route_number: 1,
        route_steps: [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC], step_uids: [u1, u2, u3],
        fields_version: 0, draft_rev: 0, has_draft: false,
      }]);

      // Today's settings page and the seed scripts send route_steps alone: the same steps, twice.
      for (let i = 0; i < 2; i++) {
        const again = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC] });
        assert.deepEqual(again.step_uids, [u1, u2, u3]);
        assert.deepEqual(again.removed_with_fields, []);
      }
      // Reordered without uids: FUNC's first occurrence keeps u1 and its second u3, wherever they
      // now stand, and the route's first station type moves with the first step.
      const moved = await saveRoute(routeId, { route_steps: [H.TYPE_INTAKE, H.TYPE_FUNC, H.TYPE_FUNC] });
      assert.deepEqual(moved.step_uids, [u2, u1, u3]);
      assert.equal(moved.test_station_type_id, H.TYPE_INTAKE);
      // INTAKE dropped: the two FUNC steps still pair by occurrence.
      const dropped = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC] });
      assert.deepEqual(dropped.step_uids, [u1, u3]);
      assert.deepEqual(dropped.removed_with_fields, [], "no draft and no version held u2's step");
      const row = await routeRow(routeId);
      assert.deepEqual(row.route_steps, [H.TYPE_FUNC, H.TYPE_FUNC]);
      assert.deepEqual(row.step_uids, [u1, u3]);
      assert.equal(row.test_station_type_id, H.TYPE_FUNC);
    });

    it("routes: PUT with step_uids moves and removes steps with their uids; a removed step's config leaves the draft and is reported; unknown and repeated uids are a 400 that changes nothing", async () => {
      const [a, b, c] = ["s_rte00001", "s_rte00002", "s_rte00003"];
      const routeId = await insertRoute(ITEM_TYPE_ROUTED, [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC], [a, b, c]);
      const rev = await saveDraft(routeId, config(
        itemStep(a, [LED]),
        kitStep(b, H.TYPE_INTAKE, "INTAKE", [{ target: "box", fields: [BOX_FIELD] }]),
        itemStep(c, [GND]),
      ));

      // The FUNC steps swap places and INTAKE leaves.
      const saved = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [c, a] });
      assert.deepEqual(saved.route_steps, [H.TYPE_FUNC, H.TYPE_FUNC]);
      assert.deepEqual(saved.step_uids, [c, a]);
      assert.deepEqual(saved.removed_with_fields, [b]);
      assert.equal(saved.test_station_type_id, H.TYPE_FUNC);
      let row = await routeRow(routeId);
      // Each config is still on its own uid; b's is gone.
      assert.deepEqual(row.fields_draft, config(itemStep(a, [LED]), itemStep(c, [GND])));
      assert.equal(row.draft_rev, rev + 1);
      assert.equal(row.draft_updated_by, ACTOR.username);

      // Order alone never rewrites the draft: it is keyed by uid.
      const back = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [a, c] });
      assert.deepEqual(back.step_uids, [a, c]);
      assert.deepEqual(back.removed_with_fields, []);
      assert.equal((await routeRow(routeId)).draft_rev, rev + 1);

      await rejectsRouteSteps(saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [a, "s_zzzzzzzz"] }), 400, "STEP_UID_UNKNOWN");
      await rejectsRouteSteps(saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [a, a] }), 400, "STEP_UID_DUPLICATE");
      // A removed uid cannot be pinned back on.
      await rejectsRouteSteps(
        saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_INTAKE, H.TYPE_FUNC], step_uids: [a, b, c] }),
        400,
        "STEP_UID_UNKNOWN",
      );
      row = await routeRow(routeId);
      assert.deepEqual(row.route_steps, [H.TYPE_FUNC, H.TYPE_FUNC]);
      assert.deepEqual(row.step_uids, [a, c]);
      assert.equal(row.draft_rev, rev + 1);
    });

    it("routes: a route inserted without step uids (as a script does) gets one per step on its first save and keeps them after; a client cannot name one", async () => {
      const routeId = (await H.one<{ test_route_id: number }>(
        "SELECT test_route_id FROM testing_routes WHERE item_type_id = $1 AND route_number = 1",
        [H.ITEM_TYPE_TWO_STEP],
      )).test_route_id;
      assert.deepEqual((await routeRow(routeId)).step_uids, [], "the write-path fixture inserts its routes without uids");

      await rejectsRouteSteps(saveRoute(routeId, { route_steps: [H.TYPE_INTAKE, H.TYPE_FUNC], step_uids: ["s_invented", null] }), 400, "STEP_UID_UNKNOWN");
      const healed = await saveRoute(routeId, { route_steps: [H.TYPE_INTAKE, H.TYPE_FUNC] });
      assert.equal(healed.step_uids.length, 2);
      for (const uid of healed.step_uids) assert.match(uid, ID_PATTERNS.step);
      assert.notEqual(healed.step_uids[0], healed.step_uids[1]);
      assert.deepEqual(healed.removed_with_fields, []);
      const again = await saveRoute(routeId, { route_steps: [H.TYPE_INTAKE, H.TYPE_FUNC] });
      assert.deepEqual(again.step_uids, healed.step_uids);
      assert.deepEqual((await routeRow(routeId)).step_uids, healed.step_uids);
    });

    it("routes: a step uid removed after publish is never minted again — the published version keeps it taken", async (t) => {
      const kept = "s_aaaaaaaa";
      const gone = "s_bbbbbbbb";
      const routeId = await insertRoute(ITEM_TYPE_ROUTED, [H.TYPE_FUNC, H.TYPE_FUNC], [kept, gone]);
      assert.equal(await publish(routeId, config(itemStep(gone, [LED]))), 1);

      const removed = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC], step_uids: [kept] });
      assert.deepEqual(removed.removed_with_fields, [gone]);
      // Neither the route nor the draft the removal left behind names it any more: only version 1 does.
      const row = await routeRow(routeId);
      assert.deepEqual(row.step_uids, [kept]);
      assert.deepEqual(row.fields_draft, { schema: 1, steps: {} });
      assert.deepEqual([...(await RS.publishedStepUids(prisma, routeId))], [gone]);

      // The next mint draws `gone` first; it is taken, so the new step gets the second draw.
      const left = scriptUidDraws(t, ["bbbbbbbb", "cccccccc"]);
      const added = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [kept, null] });
      assert.deepEqual(added.step_uids, [kept, "s_cccccccc"]);
      assert.equal(left(), 0, "both scripted draws were used: the first was refused");

      // Nor can a client name it.
      await rejectsRouteSteps(saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [kept, gone] }), 400, "STEP_UID_UNKNOWN");
    });

    it("routes: a kept uid sent for a step of another station type is a removal plus an addition — a fresh uid, its config pruned and reported — so a frozen version never shows one station's fields at another", async () => {
      // A second per-item station type, so the swap below changes no step's level.
      const TYPE_FUNC2 = 22;
      await H.q("INSERT INTO test_stations_type (test_station_type_id, test_type_desc, package_level) VALUES ($1, 'FUNC2', false)", [TYPE_FUNC2]);
      const [s1, s2, s3] = ["s_rty00001", "s_rty00002", "s_rty00003"];
      const routeId = await insertRoute(ITEM_TYPE_ROUTED, [H.TYPE_FUNC, TYPE_FUNC2, H.TYPE_FUNC], [s1, s2, s3]);
      const onFunc2: StepConfig = { ...itemStep(s2, [LED]), station_type_id: TYPE_FUNC2, station_label: "FUNC2" };
      assert.equal(await publish(routeId, config(onFunc2)), 1);
      await seedFrozenItem(4301, 1, ITEM_TYPE_ROUTED);
      await H.q("UPDATE item_routes SET current_route_step = 2 WHERE item_id = $1", [4301]);
      assert.equal((await stationFields(4301, H.STATION_FUNC_A)).body.mode, "item", "the control: step 2 is FUNC2's, with its fields");

      // Moving steps keeps every uid on its own type, there and back.
      const moved = await saveRoute(routeId, { route_steps: [TYPE_FUNC2, H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [s2, s1, s3] });
      assert.deepEqual(moved.step_uids, [s2, s1, s3]);
      assert.deepEqual(moved.removed_with_fields, []);
      const back = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, TYPE_FUNC2, H.TYPE_FUNC], step_uids: [s1, s2, s3] });
      assert.deepEqual(back.step_uids, [s1, s2, s3]);
      assert.equal((await routeRow(routeId)).fields_draft, null, "no step changed type: nothing to prune");

      // The same uids, but s2 on a FUNC step and s3 on the FUNC2 step: two new steps.
      const retyped = await saveRoute(routeId, { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC, TYPE_FUNC2], step_uids: [s1, s2, s3] });
      const [k1, n2, n3] = retyped.step_uids;
      assert.equal(k1, s1);
      for (const uid of [n2, n3]) {
        assert.match(uid, ID_PATTERNS.step);
        assert.ok(![s1, s2, s3].includes(uid), `${uid} must be a fresh uid`);
      }
      assert.notEqual(n2, n3);
      assert.deepEqual(retyped.removed_with_fields, [s2], "s2 had fields in version 1, s3 none");
      const row = await routeRow(routeId);
      assert.deepEqual(row.step_uids, [s1, n2, n3]);
      assert.deepEqual(row.fields_draft, { schema: 1, steps: {} }, "FUNC2's config left the route with its step");
      // The row frozen at version 1 stands at step 2, a FUNC station now: FUNC2's fields stay away.
      assert.deepEqual((await stationFields(4301, H.STATION_FUNC_A)).body, { mode: "legacy" });
    });

    // -------------------------------------------------------------------------------------
    // Drafts (§3.4.1) — admin.ts, as PUT / DELETE …/[id]/fields/draft run it
    // -------------------------------------------------------------------------------------

    it("drafts: each save bumps draft_rev and stores the sanitized config; a stale base_rev is a 409 carrying the current draft, an unknown step uid a 409, a bad shape a 400 — and none of them writes", async () => {
      const first = config(itemStep(UID.f1, [LED]));
      const smuggled = { ...first, extra: "dropped", steps: { [UID.f1]: { ...first.steps[UID.f1], junk: 1 } } };
      const s1 = await A.saveFieldsDraft(prisma, R.fields, { config: smuggled, base_rev: 0 }, ACTOR);
      assert.equal(s1.draft_rev, 1);
      assert.deepEqual(s1.issues, []);
      let row = await routeRow(R.fields);
      assert.deepEqual(row.fields_draft, first, "only known keys reach the database");
      assert.equal(row.draft_updated_by, ACTOR.username);
      assert.ok(row.draft_updated_at instanceof Date);

      const second = config(itemStep(UID.f1, [LED, GND]), itemStep(UID.f2, [INSULATION]));
      const s2 = await A.saveFieldsDraft(prisma, R.fields, { config: second, base_rev: 1 }, ACTOR);
      assert.equal(s2.draft_rev, 2);

      const stale = await rejectsAdmin(A.saveFieldsDraft(prisma, R.fields, { config: first, base_rev: 1 }, ACTOR), 409, "DRAFT_CONFLICT");
      assert.deepEqual(stale.extra.draft, second, "the editor reloads from the draft the 409 carries");
      assert.equal(stale.extra.draft_rev, 2);
      assert.equal(stale.extra.draft_updated_by, ACTOR.username);

      const unknown = await rejectsAdmin(
        A.saveFieldsDraft(prisma, R.fields, { config: config(itemStep("s_zzzzzzzz", [LED])), base_rev: 2 }, ACTOR),
        409,
        "STEP_UNKNOWN",
      );
      assert.deepEqual(unknown.extra, { route_id: R.fields, uids: ["s_zzzzzzzz"] });

      const shape = await rejectsAdmin(A.saveFieldsDraft(prisma, R.fields, { config: { schema: 2, steps: {} }, base_rev: 2 }, ACTOR), 400, "SHAPE_INVALID");
      assert.equal(shape.extra.path, "$");
      const badId = await rejectsAdmin(
        A.saveFieldsDraft(prisma, R.fields, { config: config(itemStep(UID.f1, [{ ...LED, id: "led" }])), base_rev: 2 }, ACTOR),
        400,
        "SHAPE_INVALID",
      );
      assert.equal(badId.extra.path, `$.steps.${UID.f1}.groups[0].fields[0]`);

      row = await routeRow(R.fields);
      assert.deepEqual(row.fields_draft, second);
      assert.equal(row.draft_rev, 2);

      // A lint error never blocks the autosave: it comes back to the editor.
      const s3 = await A.saveFieldsDraft(prisma, R.fields, { config: config(itemStep(UID.f1, [{ ...LED, label: "  " }])), base_rev: 2 }, ACTOR);
      assert.equal(s3.draft_rev, 3);
      assert.ok(s3.issues.some((i) => i.code === "FIELD_LABEL_EMPTY" && i.level === "error" && i.field_id === LED.id));
    });

    it("drafts: discarding sets fields_draft to SQL NULL (never JSON null) and bumps draft_rev; a stale base_rev is refused", async () => {
      const rev = await saveDraft(R.fields, config(itemStep(UID.f1, [LED])));
      await rejectsAdmin(A.discardFieldsDraft(prisma, R.fields, { base_rev: rev - 1 }, ACTOR), 409, "DRAFT_CONFLICT");
      assert.notEqual((await routeRow(R.fields)).fields_draft, null);

      const discarded = await A.discardFieldsDraft(prisma, R.fields, { base_rev: rev }, ACTOR);
      assert.equal(discarded.draft_rev, rev + 1);
      const row = await H.one(
        `SELECT fields_draft IS NULL AS sql_null, jsonb_typeof(fields_draft) AS json_type, draft_rev
           FROM testing_routes WHERE test_route_id = $1`,
        [R.fields],
      );
      assert.deepEqual(row, { sql_null: true, json_type: null, draft_rev: rev + 1 });
      const [listed] = await RS.listRoutes(prisma, { itemTypeId: ITEM_TYPE_FIELDS, routeNumber: 1 });
      assert.equal(listed.has_draft, false);
      assert.equal((await A.getRouteFields(prisma, R.fields)).draft, null);
    });

    it("admin: an id no int4 column can hold is a 400 (INVALID_ID in a path, INVALID_BODY in a body) — never Postgres' out-of-range 500; the largest int4 is a well-formed id that names nothing", async () => {
      const BIG = 2 ** 31;
      const MAX = BIG - 1;
      const rev = await saveDraft(R.fields, config(itemStep(UID.f1, [LED])));
      await rejectsAdmin(A.getRouteFields(prisma, BIG), 400, "INVALID_ID");
      await rejectsAdmin(A.listFieldVersions(prisma, BIG), 400, "INVALID_ID");
      await rejectsAdmin(A.getFieldVersion(prisma, BIG, 1), 400, "INVALID_ID");
      await rejectsAdmin(A.getFieldVersion(prisma, R.fields, BIG), 400, "INVALID_ID");
      await rejectsAdmin(A.saveFieldsDraft(prisma, BIG, { config: config(), base_rev: 0 }, ACTOR), 400, "INVALID_ID");
      await rejectsAdmin(A.discardFieldsDraft(prisma, BIG, { base_rev: 0 }, ACTOR), 400, "INVALID_ID");
      await rejectsAdmin(A.previewPublish(prisma, { route_ids: [BIG] }), 400, "INVALID_BODY");
      await rejectsAdmin(A.previewPublish(prisma, { route_ids: [R.fields], context_kit_id: BIG }), 400, "INVALID_BODY");
      await rejectsAdmin(A.publishFields(prisma, { route_ids: [BIG], base_revs: { [BIG]: 0 }, apply_mode: "new_only" }, ACTOR), 400, "INVALID_BODY");

      await rejectsAdmin(A.getRouteFields(prisma, MAX), 404, "ROUTE_NOT_FOUND");
      await rejectsAdmin(A.listFieldVersions(prisma, MAX), 404, "ROUTE_NOT_FOUND");
      await rejectsAdmin(A.getFieldVersion(prisma, R.fields, MAX), 404, "VERSION_NOT_FOUND");
      await rejectsAdmin(A.previewPublish(prisma, { route_ids: [MAX] }), 404, "ROUTE_NOT_FOUND");
      const preview = await A.previewPublish(prisma, { route_ids: [R.fields], context_kit_id: MAX });
      assert.deepEqual(preview.base_revs, { [R.fields]: rev });
      assert.equal((await routeRow(R.fields)).draft_rev, rev, "nothing written");
    });

    // -------------------------------------------------------------------------------------
    // Publish (§3.4.2, §3.4.3) — admin.ts, as …/fields/publish-preview and …/fields/publish run it
    // -------------------------------------------------------------------------------------

    it("publish: a lint error in any route of the batch is a 422 for preview and publish alike, and nothing is published", async () => {
      const goodRev = await saveDraft(R.fields, config(itemStep(UID.f1, [LED])));
      const badRev = await saveDraft(R.second, config(itemStep(UID.s1, [{ ...INSULATION, label: " " }])));

      const preview = await rejectsAdmin(A.previewPublish(prisma, { route_ids: [R.fields, R.second] }), 422, "LINT_ERRORS");
      const issues = preview.extra.issues as RouteIssue[];
      assert.ok(issues.some((i) =>
        i.route_id === R.second && i.code === "FIELD_LABEL_EMPTY" && i.level === "error" && i.step_uid === UID.s1 && i.field_id === INSULATION.id));
      await rejectsAdmin(
        A.publishFields(prisma, { route_ids: [R.fields, R.second], base_revs: { [R.fields]: goodRev, [R.second]: badRev }, apply_mode: "new_only" }, ACTOR),
        422,
        "LINT_ERRORS",
      );

      assert.deepEqual(await H.q("SELECT id FROM route_field_versions"), []);
      for (const [id, rev] of [[R.fields, goodRev], [R.second, badRev]]) {
        const row = await routeRow(id);
        assert.equal(row.fields_version, 0);
        assert.equal(row.draft_rev, rev);
        assert.notEqual(row.fields_draft, null, "the drafts are kept for fixing");
      }

      // The check against the live route blocks the same way: a package-level config on a
      // per-item station (it saves, as every draft does, and says so).
      const mismatched = await A.saveFieldsDraft(prisma, R.fields, {
        config: config(kitStep(UID.f1, H.TYPE_FUNC, "FUNC", [{ target: "box", fields: [SEAL] }])),
        base_rev: goodRev,
      }, ACTOR);
      assert.ok(mismatched.issues.some((i) => i.code === "STEP_SCOPE_MISMATCH" && i.level === "error" && i.step_uid === UID.f1));
      const scope = await rejectsAdmin(
        A.publishFields(prisma, { route_ids: [R.fields], base_revs: { [R.fields]: mismatched.draft_rev }, apply_mode: "new_only" }, ACTOR),
        422,
        "LINT_ERRORS",
      );
      assert.ok((scope.extra.issues as RouteIssue[]).some((i) => i.route_id === R.fields && i.code === "STEP_SCOPE_MISMATCH" && i.step_uid === UID.f1));
      assert.deepEqual(await H.q("SELECT id FROM route_field_versions"), []);
    });

    it("publish: a draft step the route no longer has is a STEP_UNKNOWN error issue — a 422 for preview and publish alike (never a 409 a dialog would take for a draft conflict) and listed by GET …/fields; PUT draft keeps its 409", async () => {
      const rev = await saveDraft(R.second, config(itemStep(UID.s1, [INSULATION])));
      // A script rewrote the route without step_uids (spec §1.3): no step has a usable uid now.
      await H.q("UPDATE testing_routes SET step_uids = '{}' WHERE test_route_id = $1", [R.second]);
      const issue = { level: "error", code: "STEP_UNKNOWN", step_uid: UID.s1, message: UNDRAWN_TEXT.stepUnknown };

      const preview = await rejectsAdmin(A.previewPublish(prisma, { route_ids: [R.second] }), 422, "LINT_ERRORS");
      assert.deepEqual(preview.extra.issues, [{ route_id: R.second, ...issue }]);
      const published = await rejectsAdmin(
        A.publishFields(prisma, { route_ids: [R.second], base_revs: { [R.second]: rev }, apply_mode: "new_only" }, ACTOR),
        422,
        "LINT_ERRORS",
      );
      assert.deepEqual(published.extra.issues, [{ route_id: R.second, ...issue }]);
      assert.deepEqual((await A.getRouteFields(prisma, R.second)).issues, [issue], "the editor lists what publish refuses");

      assert.deepEqual(await H.q("SELECT id FROM route_field_versions"), []);
      const row = await routeRow(R.second);
      assert.equal(row.fields_version, 0);
      assert.equal(row.draft_rev, rev);
      // Spec §3.2: an autosave naming a uid the route does not have stays a 409.
      await rejectsAdmin(A.saveFieldsDraft(prisma, R.second, { config: config(itemStep(UID.s1, [LED])), base_rev: rev }, ACTOR), 409, "STEP_UNKNOWN");
    });

    it("publish: two routes in one batch each become their own next version under one publish_batch — config, changes, note, apply_mode, publisher — and fields_version moves while the draft clears", async () => {
      const fieldsV1 = config(itemStep(UID.f1, [LED, GND]));
      assert.equal(await publish(R.fields, fieldsV1), 1);
      const fieldsV2 = config(itemStep(UID.f1, [LED, INTAKE_NOTE]));
      const secondV1 = config(itemStep(UID.s1, [INSULATION]));
      const revs = { [R.fields]: await saveDraft(R.fields, fieldsV2), [R.second]: await saveDraft(R.second, secondV1) };

      const impact = await A.previewPublish(prisma, { route_ids: [R.second, R.fields] });
      assert.deepEqual(
        impact.routes.map((r) => [r.route_id, r.label, r.from_version, r.to_version]),
        [[R.fields, routeOfTypeLabel(1, "FIELDS"), 1, 2], [R.second, routeOfTypeLabel(1, "SECOND"), 0, 1]].sort((x, y) => Number(x[0]) - Number(y[0])),
      );
      assert.equal(impact.totals.changes, 3);
      assert.equal(impact.totals.routes, 2);
      assert.deepEqual(impact.base_revs, revs);

      // One stale base_rev refuses the whole batch, naming the route that moved on.
      const stale = await rejectsAdmin(
        A.publishFields(prisma, { route_ids: [R.second, R.fields], base_revs: { ...revs, [R.second]: revs[R.second] - 1 }, apply_mode: "new_only" }, ACTOR),
        409,
        "DRAFT_CONFLICT",
      );
      assert.deepEqual(stale.extra.conflicts, [{ route_id: R.second, draft_rev: revs[R.second] }]);
      assert.deepEqual(await H.q("SELECT test_route_id, version FROM route_field_versions"), [{ test_route_id: R.fields, version: 1 }]);

      // Publish exactly what was previewed; the route order in the request does not matter.
      const published = await A.publishFields(
        prisma,
        { route_ids: [R.second, R.fields], base_revs: impact.base_revs, apply_mode: "new_only", note: "  עדכון שדות  " },
        ACTOR,
      );
      assert.deepEqual(published.versions, { [R.fields]: 2, [R.second]: 1 });
      assert.equal(published.bumped_items, 0);
      assert.match(published.publish_batch, UUID_RE);

      const versions = await H.q(
        `SELECT test_route_id, version, config, changes, note, apply_mode, publish_batch, published_at, published_by, published_by_name
           FROM route_field_versions ORDER BY test_route_id, version`,
      );
      const find = (routeId: number, v: number) => {
        const row = versions.find((x) => x.test_route_id === routeId && x.version === v);
        assert.ok(row, `version ${v} of route ${routeId}`);
        return row;
      };
      const removedGnd = { route_id: R.fields, step_uid: UID.f1, target: "item", kind: "field_removed", field_id: GND.id, label: GND.label, filled_count: 0 };
      for (const [row, cfg, changes] of [
        [find(R.fields, 2), fieldsV2, [
          { route_id: R.fields, step_uid: UID.f1, target: "item", kind: "field_added", field_id: INTAKE_NOTE.id, label: INTAKE_NOTE.label },
          removedGnd,
        ]],
        [find(R.second, 1), secondV1, [
          { route_id: R.second, step_uid: UID.s1, target: "item", kind: "field_added", field_id: INSULATION.id, label: INSULATION.label },
        ]],
      ] as const) {
        assert.deepEqual(row.config, cfg);
        assert.deepEqual(row.changes, changes);
        assert.equal(row.note, "עדכון שדות", "the note is stored trimmed");
        assert.equal(row.apply_mode, "new_only");
        assert.equal(row.publish_batch, published.publish_batch);
        assert.equal(row.published_by, ACTOR.username);
        assert.equal(row.published_by_name, ACTOR.name);
        assert.ok(row.published_at instanceof Date);
      }
      assert.notEqual(find(R.fields, 1).publish_batch, published.publish_batch, "version 1 came from an earlier batch");

      for (const [id, v] of [[R.fields, 2], [R.second, 1]]) {
        const row = await routeRow(id);
        assert.equal(row.fields_version, v);
        assert.equal(row.fields_draft, null);
        assert.equal(row.draft_rev, revs[id] + 1);
      }
      const view = await A.getRouteFields(prisma, R.fields);
      assert.equal(view.draft, null);
      assert.equal(view.published_version, 2);
      assert.deepEqual(view.published, fieldsV2);
      assert.deepEqual((await A.listFieldVersions(prisma, R.fields)).map((v) => v.version), [2, 1]);
    });

    /**
     * Rows on the FIELDS route (one on SECOND), each a case of the "not_reached" predicate for a
     * draft whose first changed step is position 2. `moves`: the row takes the new version.
     */
    const IN_PROGRESS: { id: number; type: number; step: number; status: number; version: number | null; finished?: true; moves: boolean }[] = [
      { id: 7001, type: ITEM_TYPE_FIELDS, step: 1, status: 2, version: 1, moves: true },      // waiting before the change
      { id: 7002, type: ITEM_TYPE_FIELDS, step: 2, status: 2, version: 1, moves: true },      // waiting AT the changed step
      { id: 7003, type: ITEM_TYPE_FIELDS, step: 2, status: 6, version: 1, moves: true },      // waiting for its kit's items
      // Taken in before station fields: keeps the fixed popup even when its route is published
      // later (spec §8.1), whatever the apply_mode.
      { id: 7004, type: ITEM_TYPE_FIELDS, step: 1, status: 2, version: null, moves: false },
      { id: 7005, type: ITEM_TYPE_FIELDS, step: 2, status: 1, version: 1, moves: false },     // in test: its popup is open
      { id: 7006, type: ITEM_TYPE_FIELDS, step: 1, status: 4, version: 1, moves: false },     // waiting for research
      { id: 7007, type: ITEM_TYPE_FIELDS, step: 1, status: 5, version: 1, moves: false },     // in research
      { id: 7008, type: ITEM_TYPE_FIELDS, step: 3, status: 2, version: 1, moves: false },     // already past the change
      { id: 7009, type: ITEM_TYPE_FIELDS, step: 1, status: 2, version: 1, finished: true, moves: false },   // finished_at alone
      { id: 7010, type: ITEM_TYPE_FIELDS, step: 3, status: 3, version: 1, finished: true, moves: false },   // done
      { id: 7011, type: ITEM_TYPE_SECOND, step: 1, status: 2, version: null, moves: false },  // another route
    ];

    /** Publishes version 1 of FIELDS, seeds IN_PROGRESS, and drafts a version 2 that changes the
     *  steps at positions 2 and 3 (so the first changed step is position 2). */
    async function seedInProgress(): Promise<void> {
      assert.equal(await publish(R.fields, config(itemStep(UID.f1, [LED]), itemStep(UID.f2, [GND]))), 1);
      for (const r of IN_PROGRESS) {
        await H.seedLegacyItem({ itemId: r.id, itemTypeId: r.type, stationId: H.STATION_FUNC_A });
        await H.q(
          `UPDATE item_routes
              SET current_route_step = $2, current_status = $3, fields_version = $4,
                  is_finished = $5, finished_at = CASE WHEN $5 THEN NOW() END
            WHERE item_id = $1`,
          [r.id, r.step, r.status, r.version, r.finished === true],
        );
      }
      await saveDraft(R.fields, config(itemStep(UID.f1, [LED]), itemStep(UID.f2, [GND, INSULATION]), itemStep(UID.f3, [INTAKE_NOTE])));
    }

    async function versionsOfInProgress(): Promise<Record<number, number | null>> {
      const rows = await H.q<{ item_id: number; fields_version: number | null }>(
        "SELECT item_id, fields_version FROM item_routes WHERE item_id = ANY($1::bigint[])",
        [IN_PROGRESS.map((r) => r.id)],
      );
      return Object.fromEntries(rows.map((r) => [r.item_id, r.fields_version]));
    }

    it("publish: 'new_only' moves no row in progress — each keeps the version it froze", async () => {
      await seedInProgress();
      const before = await versionsOfInProgress();
      const impact = await A.previewPublish(prisma, { route_ids: [R.fields] });
      const published = await A.publishFields(prisma, { route_ids: [R.fields], base_revs: impact.base_revs, apply_mode: "new_only" }, ACTOR);
      assert.deepEqual(published.versions, { [R.fields]: 2 });
      assert.equal(published.bumped_items, 0);
      assert.deepEqual(await versionsOfInProgress(), before);
    });

    it("publish: 'not_reached' moves exactly the unfinished rows that froze a version and wait (status 2 or 6) at or before the first changed step — never 1, 4, 5, finished ones or rows taken in before station fields — and the preview counts those same rows", async () => {
      await seedInProgress();
      const before = await versionsOfInProgress();
      const impact = await A.previewPublish(prisma, { route_ids: [R.fields] });
      const moving = IN_PROGRESS.filter((r) => r.moves).length;
      assert.equal(moving, 3, "fixture: 7001, 7002 and 7003");
      assert.equal(impact.not_reached, moving);
      // Every unfinished row of the route, by the version it froze.
      assert.equal(impact.items_on_routes, 8);
      assert.deepEqual(impact.by_version, [
        { route_id: R.fields, version: null, count: 1 },
        { route_id: R.fields, version: 1, count: 7 },
      ]);

      const published = await A.publishFields(prisma, { route_ids: [R.fields], base_revs: impact.base_revs, apply_mode: "not_reached" }, ACTOR);
      assert.equal(published.bumped_items, impact.not_reached);
      assert.deepEqual(
        await versionsOfInProgress(),
        Object.fromEntries(IN_PROGRESS.map((r) => [r.id, r.moves ? 2 : before[r.id]])),
      );
      const v2 = await H.one("SELECT apply_mode FROM route_field_versions WHERE test_route_id = $1 AND version = 2", [R.fields]);
      assert.equal(v2.apply_mode, "not_reached");
    });

    it("publish: filled_count of a removed field counts the saved results holding it — in details.fields and in a close-wizard decision's fields — on that route and step only", async () => {
      // FIELDS: LED at both steps (a field id is unique per step only); the draft removes it at
      // the first step alone.
      await publish(R.fields, config(itemStep(UID.f1, [LED, GND]), itemStep(UID.f2, [LED, INSULATION])));
      await saveDraft(R.fields, config(itemStep(UID.f1, [GND]), itemStep(UID.f2, [LED, INSULATION])));
      // The kit: each_item at the closing step goes.
      await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [
        { target: "box", fields: [SEAL] },
        { target: "each_item", fields: [EXT_FIELD] },
      ])));
      await saveDraft(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL] }])));

      const led = storedChoice(LED, "o_led00001");
      const ext = storedChoice(EXT_FIELD, "o_ext00001");
      const schema = (routeId: number, stepUid: string, target: string) => ({ route_id: routeId, v: 1, step_uid: stepUid, target });
      const rows: unknown[] = [
        { schema: schema(R.fields, UID.f1, "item"), fields: { [LED.id]: led, [GND.id]: { t: "number", label: GND.label, value: 0.05, unit: "Ω", in_range: true } } }, // counts
        { schema: schema(R.fields, UID.f1, "item"), fields: { [LED.id]: led } },                    // counts
        { schema: schema(R.fields, UID.f1, "item"), fields: {} },                                   // LED left blank: never stored
        { schema: schema(R.fields, UID.f2, "item"), fields: { [LED.id]: led } },                    // another step
        { schema: schema(R.second, UID.f1, "item"), fields: { [LED.id]: led } },                    // another route
        { sku: "MK-1" },                                                                            // legacy
        [1, 2, 3],                                                                                  // legacy array
        null,
        { // the box at closing: a "packed anyway" item's fields live in its decision — counts
          schema: schema(R.kit, UID.kClose, "box"), fields: {},
          decisions: [
            { item_id: "1", decision: "packed_anyway", note: "", fields: { [EXT_FIELD.id]: ext }, suggested: "pass" },
            { item_id: "2", decision: "missing", note: "" },
          ],
        },
        { schema: schema(R.kit, UID.kClose, "kit_item"), fields: { [EXT_FIELD.id]: ext } },        // an arrived item — counts
        { // only a box row's decisions carry fields (submit.ts strips them elsewhere): no fill
          schema: schema(R.kit, UID.kClose, "kit_item"), fields: {},
          decisions: [{ item_id: "3", decision: "packed_anyway", note: "", fields: { [EXT_FIELD.id]: ext } }],
        },
        { schema: schema(R.kit, UID.kClose, "box"), fields: {}, decisions: { not: "an array" } },  // never breaks the count
        { schema: schema(R.kit, UID.kOpen, "kit_item"), fields: { [EXT_FIELD.id]: ext } },         // another step
      ];
      for (const [i, details] of rows.entries()) {
        await H.q(
          `INSERT INTO test_results (item_id, test_station_id, test_station_type_id, route_step, details)
           VALUES ($1, $2, $3, 1, $4::jsonb)`,
          [9000 + i, H.STATION_FUNC_A, H.TYPE_FUNC, details === null ? null : JSON.stringify(details)],
        );
      }

      const removedCounts = (changes: { kind: string; field_id?: string; filled_count?: number }[]) =>
        changes.filter((c) => c.kind === "field_removed").map((c) => [c.field_id, c.filled_count]);
      const impact = await A.previewPublish(prisma, { route_ids: [R.fields, R.kit], context_kit_id: H.ITEM_TYPE_PACKAGE_CLOSE });
      const byRoute = new Map(impact.routes.map((r) => [r.route_id, r]));
      assert.deepEqual(removedCounts(byRoute.get(R.fields)!.changes), [[LED.id, 2]]);
      assert.deepEqual(removedCounts(byRoute.get(R.kit)!.changes), [[EXT_FIELD.id, 2]]);
      assert.equal(byRoute.get(R.kit)!.label, KIT_ROUTE_LABEL);

      // The published version keeps the counts it was published with.
      const published = await A.publishFields(prisma, { route_ids: [R.fields, R.kit], base_revs: impact.base_revs, apply_mode: "new_only" }, ACTOR);
      assert.deepEqual(published.versions, { [R.fields]: 2, [R.kit]: 2 });
      assert.deepEqual(removedCounts((await A.getFieldVersion(prisma, R.fields, 2)).changes ?? []), [[LED.id, 2]]);
      assert.deepEqual(removedCounts((await A.getFieldVersion(prisma, R.kit, 2)).changes ?? []), [[EXT_FIELD.id, 2]]);
    });

    it("publish: 'not_reached' locks the rows it moves only after every 'מולא ב-N בדיקות' scan — a worker's start-test or submit never waits on a scan of test_results", async () => {
      // FIELDS (the lower id, so written first) moves a waiting row; SECOND removes a field, so
      // publish scans test_results for its fill count.
      assert.ok(R.fields < R.second, "fixture: FIELDS comes first in the batch");
      await publish(R.fields, config(itemStep(UID.f1, [LED])));
      await seedFrozenItem(7101, 1);
      await publish(R.second, config(itemStep(UID.s1, [INSULATION, LED])));
      const revs = {
        [R.fields]: await saveDraft(R.fields, config(itemStep(UID.f1, [LED, GND]))),
        [R.second]: await saveDraft(R.second, config(itemStep(UID.s1, [INSULATION]))),
      };

      const heldDuringScan: boolean[] = [];
      const published = await A.publishFields(lockProbe(heldDuringScan), { route_ids: [R.fields, R.second], base_revs: revs, apply_mode: "not_reached" }, ACTOR);
      assert.deepEqual(published.versions, { [R.fields]: 2, [R.second]: 2 });
      assert.equal(published.bumped_items, 1);
      assert.equal(await versionOf(7101), 2);
      assert.deepEqual(heldDuringScan, [false], "the one scan (LED, removed from SECOND) ran before any item_routes row was locked");
    });

    // -------------------------------------------------------------------------------------
    // Freeze (§1.5): the version a row is built from is fixed at intake and only moves with
    // its route
    // -------------------------------------------------------------------------------------

    it("freeze: intake after publish gives the box the kit route's version and each item its own route's — an unpublished route NULL; an item added later takes its route's version at that moment", async () => {
      const kitCfg = config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL] }]));
      assert.equal(await publish(R.kit, kitCfg), 1);
      await publish(R.inBox, config(itemStep(UID.bFunc, [LED])));
      assert.equal(await publish(R.inBox, config(itemStep(UID.bFunc, [LED, GND]))), 2);

      const kit = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT]);
      const [a, b] = kit.itemIds;
      assert.equal(await versionOf(kit.packageId), 1, "the box: the kit route's version");
      assert.equal(await versionOf(a), 2, "IN_BOX: its own route's current version");
      assert.equal(await versionOf(b), null, "IN_BOX_ALT: never published");

      // IN_BOX_ALT is published now: an item added from here on takes it; b keeps its NULL.
      assert.equal(await publish(R.alt, config(itemStep(UID.aFunc, [GND]))), 1);
      const c = await addKitItem(kit.packageId, H.ITEM_TYPE_IN_BOX_ALT, "SN-KIT-3");
      assert.equal(await versionOf(c), 1);
      assert.equal(await publish(R.inBox, config(itemStep(UID.bFunc, [GND]))), 3);
      const d = await addKitItem(kit.packageId, H.ITEM_TYPE_IN_BOX, "SN-KIT-4");
      assert.equal(await versionOf(d), 3);
      assert.deepEqual(
        [await versionOf(kit.packageId), await versionOf(a), await versionOf(b)],
        [1, 2, null],
        "rows already taken in keep what they froze",
      );
    });

    it("freeze: a retype without a box reset re-freezes the row at its new route's current version", async () => {
      await publish(R.inBox, config(itemStep(UID.bFunc, [LED])));
      await publish(R.alt, config(itemStep(UID.aFunc, [LED])));
      assert.equal(await publish(R.alt, config(itemStep(UID.aFunc, [GND]))), 2);

      // An item in a box still at its opening is retyped on its own.
      const kit = await createKit([H.ITEM_TYPE_IN_BOX]);
      const [a] = kit.itemIds;
      assert.equal(await versionOf(a), 1);
      const retyped = await H.updateItem(a, {
        customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_IN_BOX_ALT, serialNumber: "SN-KIT-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR",
      });
      assert.equal(retyped.status, 200, JSON.stringify(retyped.body));
      assert.equal(retyped.body.retyped, true);
      assert.equal(retyped.body.packageReset, null);
      assert.equal(await versionOf(a), 2, "IN_BOX_ALT's current version");
      assert.equal(await versionOf(kit.packageId), null, "the box is untouched");

      // A plain item: to a published route, then to one never published.
      await publish(R.fields, config(itemStep(UID.f1, [LED])));
      await publish(R.second, config(itemStep(UID.s1, [LED])));
      assert.equal(await publish(R.second, config(itemStep(UID.s1, [GND]))), 2);
      await seedFrozenItem(4201, 1);
      const body = { customer: H.CUSTOMER_ID, serialNumber: "SN-4201", makat: "MK-1", model: "MODEL", manufacturer: "MFR" };
      const toSecond = await H.updateItem(4201, { ...body, itemType: ITEM_TYPE_SECOND });
      assert.equal(toSecond.status, 200, JSON.stringify(toSecond.body));
      assert.equal(await versionOf(4201), 2);
      const toUnpublished = await H.updateItem(4201, { ...body, itemType: H.ITEM_TYPE_TWO_STEP });
      assert.equal(toUnpublished.status, 200, JSON.stringify(toUnpublished.body));
      assert.equal(await versionOf(4201), null);
    });

    it("freeze: a retype that resets the box re-freezes every reset row at its route's current version", async () => {
      // The kit's fields are at closing only, so the opening runs as today.
      await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL] }])));
      await publish(R.inBox, config(itemStep(UID.bFunc, [LED])));
      await publish(R.alt, config(itemStep(UID.aFunc, [LED])));
      const kit = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX]);
      const [a, b] = kit.itemIds;
      assert.deepEqual([await versionOf(kit.packageId), await versionOf(a), await versionOf(b)], [1, 1, 1]);
      await openKit(kit);
      assert.equal((await H.routeRow(kit.packageId)).current_route_step, 2);

      // Newer versions everywhere — three distinct numbers, so each row's source is visible.
      assert.equal(await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL, BOX_FIELD] }]))), 2);
      assert.equal(await publish(R.inBox, config(itemStep(UID.bFunc, [GND]))), 2);
      await publish(R.alt, config(itemStep(UID.aFunc, [GND])));
      assert.equal(await publish(R.alt, config(itemStep(UID.aFunc, [INSULATION]))), 3);

      const reset = await H.updateItem(a, {
        customer: H.CUSTOMER_ID, itemType: H.ITEM_TYPE_IN_BOX_ALT, serialNumber: "SN-KIT-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR",
        confirmPackageReset: true, workerId: H.WORKER_ID, workerName: H.WORKER_NAME,
      });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      assert.deepEqual(reset.body.packageReset.map(Number).sort(), [kit.packageId, a, b].sort());
      assert.equal(await versionOf(kit.packageId), 2, "the box: the kit route's current version");
      assert.equal(await versionOf(a), 3, "the retyped item: its NEW route's current version");
      assert.equal(await versionOf(b), 2, "the other item: its route's current version");
      for (const id of [kit.packageId, a, b]) {
        const route = await H.routeRow(id);
        assert.equal(route.current_route_step, 1);
        assert.equal(route.current_status, H.STATUS.queued);
      }
    });

    // -------------------------------------------------------------------------------------
    // GET /api/testing/station-fields (§3.3) — the real handler
    // -------------------------------------------------------------------------------------

    it("station-fields: legacy for a row with no frozen version, step_uids out of line with route_steps, a step its frozen version does not configure, research status or a research station", async () => {
      assert.equal(await publish(R.fields, ITEM_CONFIG), 1);
      await seedFrozenItem(5101, null);
      const LEGACY = { mode: "legacy" };
      const read = async (stationId: number = H.STATION_FUNC_A) => {
        const r = await stationFields(5101, stationId);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
      };
      const setRow = (sql: string, ...params: unknown[]) => H.q(`UPDATE item_routes SET ${sql} WHERE item_id = $1`, [5101, ...params]);

      assert.deepEqual(await read(), LEGACY, "taken in before the route was published");
      await setRow("fields_version = $2", 1);
      assert.equal((await read()).mode, "item", "the control: the same row, frozen");

      await H.q("UPDATE testing_routes SET step_uids = $2::text[] WHERE test_route_id = $1", [R.fields, [UID.f1, UID.f2]]);
      assert.deepEqual(await read(), LEGACY, "two uids for three steps");
      await H.q("UPDATE testing_routes SET step_uids = NULL WHERE test_route_id = $1", [R.fields]);
      assert.deepEqual(await read(), LEGACY, "no uids at all");
      await H.q("UPDATE testing_routes SET step_uids = $2::text[] WHERE test_route_id = $1", [R.fields, [UID.f1, UID.f2, UID.f3]]);

      // Step 2: version 1 has nothing there. Version 2 has — but the row is frozen at 1.
      await setRow("current_route_step = 2");
      assert.deepEqual(await read(), LEGACY);
      assert.equal(await publish(R.fields, config(itemStep(UID.f1, [LED]), itemStep(UID.f2, [GND]))), 2);
      assert.deepEqual(await read(), LEGACY, "the frozen version governs, not the latest");
      await setRow("fields_version = $2", 2);
      assert.deepEqual((await read()).schema, { route_id: R.fields, v: 2, step_uid: UID.f2, target: "item" });
      await setRow("current_route_step = 1, fields_version = $2", 1);

      for (const status of [4, 5]) {
        await setRow("current_status = $2", status);
        assert.deepEqual(await read(), LEGACY, `status ${status}`);
      }
      await setRow("current_status = $2", 2);
      assert.deepEqual(await read(H.STATION_RESEARCH), LEGACY, "opened on a research station");
      assert.equal((await read()).mode, "item");
      assert.equal((await stationFields(5101)).body.mode, "item", "stationId is optional");

      assert.deepEqual(await stationFields(5199), { status: 404, body: { error: "Item route not found", code: "ITEM_ROUTE_NOT_FOUND" } });
      assert.equal((await stationFields("abc")).status, 400);
      assert.equal((await stationFields(5101, 0)).status, 400);
    });

    it("station-fields: item mode — the step's item group, the schema the submit must echo, and the gate", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(5201, 1);
      const r = await stationFields(5201, H.STATION_FUNC_A);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, {
        mode: "item",
        schema: { route_id: R.fields, v: 1, step_uid: UID.f1, target: "item" },
        fields: [SECTION, LED, GND, INSULATION, INTAKE_NOTE],
        gate: GATE_FINISH_ON_REQUIRED,
      });
    });

    it("station-fields: package mode — the box row at a package-level step gets the box group and every kit item by package_seq, each_item first and then its own type's group", async () => {
      await publish(R.kit, config(kitStep(UID.kOpen, H.TYPE_INTAKE, "INTAKE", [
        { target: { item_type_id: H.ITEM_TYPE_IN_BOX_ALT }, fields: [CABLE] },   // listed before each_item on purpose
        { target: "box", fields: [BOX_FIELD] },
        { target: "each_item", fields: [EXT_FIELD] },
      ])));
      const kit = await createKit([H.ITEM_TYPE_IN_BOX_ALT, H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT]);
      const [a, b, c] = kit.itemIds;
      // Out of item id order, so the order below can only be package_seq's.
      await H.q("UPDATE items SET package_seq = 50 WHERE item_id = $1", [a]);

      const r = await stationFields(kit.packageId, H.STATION_INTAKE);
      assert.equal(r.status, 200);
      const each = { target: "each_item", fields: [EXT_FIELD] };
      const altGroup = { target: { item_type_id: H.ITEM_TYPE_IN_BOX_ALT }, fields: [CABLE] };
      assert.deepEqual(r.body, {
        mode: "package",
        schema: { route_id: R.kit, v: 1, step_uid: UID.kOpen },
        box: [BOX_FIELD],
        items: [
          { item_id: String(b), package_seq: 2, item_type_id: H.ITEM_TYPE_IN_BOX, item_type_desc: "IN_BOX", groups: [each] },
          { item_id: String(c), package_seq: 3, item_type_id: H.ITEM_TYPE_IN_BOX_ALT, item_type_desc: "IN_BOX_ALT", groups: [each, altGroup] },
          { item_id: String(a), package_seq: 50, item_type_id: H.ITEM_TYPE_IN_BOX_ALT, item_type_desc: "IN_BOX_ALT", groups: [each, altGroup] },
        ],
        gate: GATE_FINISH_ON_REQUIRED,
      });
    });

    // -------------------------------------------------------------------------------------
    // POST /api/testing/results (§3.4) — the real handler
    // -------------------------------------------------------------------------------------

    it("results: a row without a frozen version stores its Details exactly as sent — nothing added, no size cap — and a schema on it is a 409", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6101, null);

      const before = await footprint(6101);
      const stale = await submitAt(6101, H.STATION_FUNC_A, { Details: { schema: itemSchema(), fields: validFields() } });
      assert.equal(stale.status, 409);
      assert.deepEqual(stale.body, { error: UNDRAWN_TEXT.schemaMismatch, code: "FIELDS_SCHEMA_MISMATCH" });
      assert.deepEqual(await footprint(6101), before);

      const details = {
        sku: "MK-1",
        verdict: { ok: "fail", note: "פגם" },          // the verdict a legacy wizard writes: kept, never extended
        fields: [{ label: "legacy", value: 1 }],       // a key the new block also uses: untouched
        blob: "x".repeat(300_000),                     // over the cap a config would impose
      };
      const res = await submitAt(6101, H.STATION_FUNC_A, { Result: 2, Passed: false, Comments: "legacy popup", Details: details });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(await storedResults(6101), [{ result: 2, passed: false, comments: "legacy popup", details }]);
    });

    it("results: a kit's rows store today's wizard Details exactly as sent (§8.1) — opening, per-item and closing — when nothing is published, and when the frozen versions configure other steps", async () => {
      // The shapes today's popups write (VerdictStation, PhotoStation, PackageOpenWizard and
      // PackageCloseWizard, each for its items and its box), with fixture values.
      const verdictShape = { station: `type-${H.TYPE_FUNC}`, sku: "MK-1", verdict: { ok: "pass", note: "" } };
      const photoShape = { station: `type-${H.TYPE_FUNC}`, sku: "MK-1", hasRU: false, photo: { ok: "fail", note: "scratch", photos: ["photos/a.jpg", "photos/b.jpg"] } };
      const openItem = (kitId: number) => ({
        sku: "MK-1", hasRU: false,
        weight: { reference: 1.2, measured: 1.25, diffPct: 4.2, pass: true },
        product: { ok: "pass", note: "", photos: ["photos/p.jpg"] },
        package_id: String(kitId), opening: true,
      });
      const openBox = (itemIds: number[]) => ({
        sku: "MK-BOX", hasRU: null, pkg: { ok: "pass", note: "", photos: ["photos/box.jpg"] },
        itemCount: itemIds.length, registeredCount: itemIds.length, templateCount: itemIds.length, labelsPrinted: true,
        packageItemIds: itemIds.map(String), opening: true,
      });
      const closeItem = (kitId: number) => ({ closing: true, packed: true, package_id: String(kitId) });
      const closeBox = (itemIds: number[]) => ({
        sku: "MK-BOX", hasRU: null, closing: true,
        checks: [{ label: "check-1", ok: true }, { label: "check-2", ok: true }, { label: "check-3", ok: true }],
        note: "", packed: itemIds.map(String), decisions: [],
      });

      /** One submit, stored exactly as sent. */
      async function storedAsSent(itemId: number, stationId: number, submitId: string, details: unknown): Promise<void> {
        const r = await H.submitResult({ ItemID: itemId, StationID: stationId, SubmitID: submitId, Passed: true, Details: details });
        assert.equal(r.status, 200, `${itemId}: ${JSON.stringify(r.body)}`);
        assert.deepEqual((await storedResults(itemId)).at(-1)!.details, details ?? null, `${itemId} at ${stationId}`);
      }
      /** The opening as today's wizard sends it: the items, then the box, under one SubmitID. */
      async function openAsToday(kit: { packageId: number; itemIds: number[] }): Promise<void> {
        await H.startTest({ itemId: kit.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
        const submitId = randomUUID();
        for (const id of kit.itemIds) await storedAsSent(id, H.STATION_INTAKE, submitId, openItem(kit.packageId));
        await storedAsSent(kit.packageId, H.STATION_INTAKE, submitId, openBox(kit.itemIds));
      }
      /** Each item through its per-item step with one of `shapes` (undefined = PopUpTestDialog: no Details). */
      async function perItemAsToday(itemIds: number[], shapes: unknown[]): Promise<void> {
        for (const [i, id] of itemIds.entries()) {
          await H.startTest({ itemId: id, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
          await storedAsSent(id, H.STATION_FUNC_A, randomUUID(), shapes[i % shapes.length]);
        }
      }
      /** The closing as today's wizard sends it, every item having arrived. */
      async function closeAsToday(kit: { packageId: number; itemIds: number[] }): Promise<void> {
        await H.startTest({ itemId: kit.packageId, stationId: H.STATION_CLOSE, actionUuid: randomUUID() });
        const submitId = randomUUID();
        for (const id of kit.itemIds) await storedAsSent(id, H.STATION_CLOSE, submitId, closeItem(kit.packageId));
        await storedAsSent(kit.packageId, H.STATION_CLOSE, submitId, closeBox(kit.itemIds));
        assert.equal((await H.routeRow(kit.packageId)).is_finished, true);
      }

      // 1. Nothing published: every row frozen NULL.
      const none = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await Promise.all([none.packageId, ...none.itemIds].map(versionOf)), [null, null, null]);
      await openAsToday(none);
      await perItemAsToday(none.itemIds, [verdictShape, photoShape]);
      await closeAsToday(none);

      // 2. The kit's version 1 has fields at closing only, and IN_BOX's own version 1 only at its
      //    opening step — which a kit item answers through the KIT row, so at FUNC it has nothing.
      await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL] }])));
      await publish(R.inBox, config(kitStep(UID.bOpen, H.TYPE_INTAKE, "INTAKE", [{ target: "each_item", fields: [EXT_FIELD] }])));
      const atOne = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await Promise.all([atOne.packageId, ...atOne.itemIds].map(versionOf)), [1, 1, 1]);
      await openAsToday(atOne);
      await perItemAsToday(atOne.itemIds, [verdictShape, photoShape]);

      // 3. The kit's version 2 has fields at opening only: that opening carries them, its closing
      //    is today's again.
      const OPEN_V2 = config(kitStep(UID.kOpen, H.TYPE_INTAKE, "INTAKE", [{ target: "each_item", fields: [INSULATION] }]));
      assert.equal(await publish(R.kit, OPEN_V2), 2);
      const atTwo = await createKit([H.ITEM_TYPE_IN_BOX]);
      assert.deepEqual(await Promise.all([atTwo.packageId, ...atTwo.itemIds].map(versionOf)), [2, 1]);
      await H.startTest({ itemId: atTwo.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
      const kitSchema = { route_id: R.kit, v: 2, step_uid: UID.kOpen };
      const submitId = randomUUID();
      for (const [id, target] of [[atTwo.itemIds[0], "kit_item"], [atTwo.packageId, "box"]] as const) {
        const r = await H.submitResult({ ItemID: id, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { schema: { ...kitSchema, target } } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
      }
      await perItemAsToday(atTwo.itemIds, [undefined]);
      await closeAsToday(atTwo);
    });

    it("results: with a config, Details lacking the schema the popup was built from — none, or another route, version, step or target — are a 409 and nothing is written", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6201, 1);
      const before = await footprint(6201);
      const good = itemSchema();
      const refused: { label: string; extra: Record<string, unknown> }[] = [
        { label: "no Details at all", extra: {} },
        { label: "no schema", extra: { Details: { fields: validFields() } } },
        { label: "another version", extra: { Details: { schema: { ...good, v: 2 }, fields: validFields() } } },
        { label: "the version as text", extra: { Details: { schema: { ...good, v: "1" }, fields: validFields() } } },
        { label: "another step", extra: { Details: { schema: { ...good, step_uid: UID.f2 }, fields: validFields() } } },
        { label: "another target", extra: { Details: { schema: { ...good, target: "box" }, fields: validFields() } } },
        { label: "another route", extra: { Details: { schema: { ...good, route_id: R.second }, fields: validFields() } } },
      ];
      for (const { label, extra } of refused) {
        const r = await submitAt(6201, H.STATION_FUNC_A, extra);
        assert.equal(r.status, 409, label);
        assert.deepEqual(r.body, { error: UNDRAWN_TEXT.schemaMismatch, code: "FIELDS_SCHEMA_MISMATCH" }, label);
      }
      assert.deepEqual(await footprint(6201), before);
      const accepted = await submitAt(6201, H.STATION_FUNC_A, { Details: { schema: good, fields: validFields() } });
      assert.equal(accepted.status, 200, "the control: the same values with the right schema");
    });

    it("results: a value that does not fit its field — wrong type, unknown option — is a 400 FIELDS_INVALID and nothing is written", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6251, 1);
      const before = await footprint(6251);
      for (const fields of [
        { ...validFields(), [LED.id]: { t: "pass_fail", ok: "pass" } },
        { ...validFields(), [LED.id]: choice("o_zzzzzzzz") },
        { ...validFields(), [GND.id]: { t: "number", value: "0.05" } },
      ]) {
        const r = await submitAt(6251, H.STATION_FUNC_A, { Details: { schema: itemSchema(), fields } });
        assert.equal(r.status, 400, JSON.stringify(fields));
        assert.equal(r.body.code, "FIELDS_INVALID");
      }
      assert.deepEqual(await footprint(6251), before);
    });

    it("results: missing required fields or a missing note are a 422 with the artboard-14 alert text and what is missing; nothing is written", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6301, 1);
      const before = await footprint(6301);
      const cases = [
        { fields: {}, text: fieldsGateText(2, 0), missing: [{ field_id: LED.id, reason: "required" }, { field_id: GND.id, reason: "required" }] },
        { fields: { [LED.id]: choice("o_led00001") }, text: fieldsGateText(1, 0), missing: [{ field_id: GND.id, reason: "required" }] },
        // A failing value whose field demands a note; a blank note is no note.
        { fields: { [LED.id]: choice("o_led00003", "   "), [GND.id]: num(0.05) }, text: fieldsGateText(0, 1), missing: [{ field_id: LED.id, reason: "note" }] },
      ];
      for (const c of cases) {
        assert.ok(c.text);
        const r = await submitAt(6301, H.STATION_FUNC_A, { Details: { schema: itemSchema(), fields: c.fields } });
        assert.equal(r.status, 422, JSON.stringify(c.fields));
        assert.deepEqual(r.body, { error: c.text, code: "FIELDS_INCOMPLETE", missing: c.missing });
      }
      assert.deepEqual(await footprint(6301), before);
    });

    it("results: a submit is re-derived from the config — label, option label and tone from the definition, unknown keys dropped, blank fields not stored, suggested recomputed, overridden recorded — while Result, Passed, Comments and every other key stay as sent", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6401, 1);
      const res = await submitAt(6401, H.STATION_FUNC_A, {
        Result: 3,
        Passed: true,
        Comments: "worker comment",
        Details: {
          sku: "MK-1",
          extra_key: { kept: [1, "two"] },
          schema: { ...itemSchema(), client_key: "ignored" },
          fields: {
            [LED.id]: { t: "choice_row", label: "LIE", opt: "o_led00003", opt_label: "LIE", tone: "pass", note: "  נורית כבויה  " },
            [GND.id]: { t: "number", label: "LIE", value: 0.05, unit: "V", in_range: false },
            [INSULATION.id]: { t: "pass_fail", ok: null, note: "   " },                // blank
            [INTAKE_NOTE.id]: { t: "text", value: "   ", note: "notes are off here" },  // blank; the note is dropped
            [SECTION.id]: { t: "text", value: "a header holds no value" },
            f_zzzzzzz1: { t: "text", value: "not in the config" },
          },
          verdict: { ok: "pass", note: "בדיקה חוזרת", suggested: "pass", overridden: false, extra: 1 },
        },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(await storedResults(6401), [{
        result: 3,
        passed: true,
        comments: "worker comment",
        details: {
          sku: "MK-1",
          extra_key: { kept: [1, "two"] },
          schema: { route_id: R.fields, v: 1, step_uid: UID.f1, target: "item" },
          fields: {
            [LED.id]: storedChoice(LED, "o_led00003", "  נורית כבויה  "),
            [GND.id]: { t: "number", label: GND.label, value: 0.05, unit: "Ω", in_range: true },
          },
          // The worker said pass; the server's own evaluation says fail. Both are kept.
          verdict: { ok: "pass", note: "בדיקה חוזרת", suggested: "fail", overridden: true },
        },
      }]);
    });

    it("results: a note over its maximum is a 400 NOTE_TOO_LONG even when 'send to research' turns the gate off, and nothing is written", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6501, 1);
      await H.startTest({ itemId: 6501, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
      const before = await footprint(6501);
      for (const fields of [
        { [LED.id]: choice("o_led00003", "x".repeat(501)) },   // note_max 500
        { [GND.id]: num(0.5, "x".repeat(1001)) },               // no note_max: 1000
      ]) {
        const r = await submitAt(6501, H.STATION_FUNC_A, { sendToResearch: true, Details: { schema: itemSchema(), fields } });
        assert.equal(r.status, 400);
        assert.deepEqual(r.body, { error: UNDRAWN_TEXT.noteTooLong, code: "NOTE_TOO_LONG" });
      }
      assert.deepEqual(await footprint(6501), before);
      assert.equal((await H.routeRow(6501)).current_status, H.STATUS.testing, "still in test, not in research");
    });

    it("results: 'send to research' is never gated — required fields may stay empty, notes at their maximum pass, the block is still re-derived — and research submits carry no fields", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6601, 1);
      await H.startTest({ itemId: 6601, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
      const ledNote = "y".repeat(500);
      const gndNote = "z".repeat(1000);
      const sent = await submitAt(6601, H.STATION_FUNC_A, {
        sendToResearch: true,
        Details: { schema: itemSchema(), fields: { [LED.id]: choice("o_led00003", ledNote), [GND.id]: num(null, gndNote) } },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const [stored] = await storedResults(6601);
      assert.deepEqual(stored.details, {
        schema: { route_id: R.fields, v: 1, step_uid: UID.f1, target: "item" },
        fields: {
          [LED.id]: storedChoice(LED, "o_led00003", ledNote),
          [GND.id]: { t: "number", label: GND.label, value: null, unit: "Ω", in_range: null, note: gndNote },
        },
        verdict: { suggested: "fail" },
      });
      assert.equal((await H.routeRow(6601)).current_status, H.STATUS.queued_research);

      // current_route_step still points at the configured step, but research never carries fields.
      assert.deepEqual((await stationFields(6601)).body, { mode: "legacy" });
      await H.startTest({ itemId: 6601, stationId: H.STATION_RESEARCH, actionUuid: randomUUID() });
      assert.deepEqual((await stationFields(6601, H.STATION_RESEARCH)).body, { mode: "legacy" });
      const note = await submitAt(6601, H.STATION_RESEARCH, { Details: { research: "interim" } });
      assert.equal(note.status, 200, JSON.stringify(note.body));
      const back = await submitAt(6601, H.STATION_RESEARCH, { returnToRoute: true });
      assert.equal(back.status, 200, JSON.stringify(back.body));
      assert.deepEqual((await storedResults(6601))[1].details, { research: "interim" });
      // Back on the route, at the same step: its fields again.
      assert.equal((await stationFields(6601, H.STATION_FUNC_A)).body.mode, "item");
    });

    it("results: a replay with the same SubmitID writes nothing and is not validated again", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6701, 1);
      const body = {
        ItemID: 6701, StationID: H.STATION_FUNC_A, SubmitID: randomUUID(), Passed: true,
        Details: { schema: itemSchema(), fields: validFields() },
      };
      const first = await H.submitResult(body);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal((await H.routeRow(6701)).current_route_step, 2);
      const after = await footprint(6701);

      // The row moved on to a step version 1 does not configure: checked now, a schema there is a 409.
      const replay = await H.submitResult(body);
      assert.equal(replay.status, 200, JSON.stringify(replay.body));
      assert.equal(replay.body.replay, true);
      assert.deepEqual(await footprint(6701), after);
      const fresh = await H.submitResult({ ...body, SubmitID: randomUUID() });
      assert.equal(fresh.status, 409, "the control: the same Details under a new SubmitID ARE checked");
    });

    it("results: Details over 256000 characters are a 413 when the row has a config; at the limit they are accepted", async () => {
      await publish(R.fields, ITEM_CONFIG);
      await seedFrozenItem(6801, 1);
      const before = await footprint(6801);
      const base = { schema: itemSchema(), fields: validFields(), pad: "" };
      const room = S.MAX_DETAILS_JSON - JSON.stringify(base).length;
      const over = await submitAt(6801, H.STATION_FUNC_A, { Details: { ...base, pad: "x".repeat(room + 1) } });
      assert.equal(over.status, 413);
      assert.equal(over.body.code, "DETAILS_TOO_LARGE");
      assert.deepEqual(await footprint(6801), before);
      const atLimit = await submitAt(6801, H.STATION_FUNC_A, { Details: { ...base, pad: "x".repeat(room) } });
      assert.equal(atLimit.status, 200, JSON.stringify(atLimit.body));
    });

    it("results: at a kit's opening each item row answers the KIT route's version and step — each_item, then its own type's group — and the box row answers 'box'", async () => {
      assert.equal(await publish(R.kit, config(kitStep(UID.kOpen, H.TYPE_INTAKE, "INTAKE", [
        { target: { item_type_id: H.ITEM_TYPE_IN_BOX }, fields: [STAND] },
        { target: "box", fields: [BOX_FIELD] },
        { target: "each_item", fields: [EXT_FIELD] },
      ]))), 1);
      // IN_BOX's own route is at version 2: an item's own version never governs a package-level step.
      await publish(R.inBox, config(itemStep(UID.bFunc, [LED])));
      assert.equal(await publish(R.inBox, config(itemStep(UID.bFunc, [LED, GND]))), 2);
      const kit = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT]);
      const [a, b] = kit.itemIds;
      assert.deepEqual([await versionOf(kit.packageId), await versionOf(a), await versionOf(b)], [1, 2, null]);

      await H.startTest({ itemId: kit.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
      const sf = await stationFields(kit.packageId, H.STATION_INTAKE);
      assert.equal(sf.body.mode, "package");
      const kitSchema = sf.body.schema;   // what the popup echoes back
      assert.deepEqual(kitSchema, { route_id: R.kit, v: 1, step_uid: UID.kOpen });
      const atOpening = (itemId: number, details: unknown) => submitAt(itemId, H.STATION_INTAKE, { Passed: true, Details: details });
      const aFields = { [EXT_FIELD.id]: choice("o_ext00002"), [STAND.id]: choice("o_prt00001") };

      const aBefore = await footprint(a);
      for (const schema of [
        { ...kitSchema, target: "item" },
        { route_id: R.inBox, v: 2, step_uid: UID.bOpen, target: "kit_item" },   // the item's own route and version
      ]) {
        const r = await atOpening(a, { schema, fields: aFields });
        assert.equal(r.status, 409, JSON.stringify(schema));
      }
      // Its type's group is part of what it answers.
      const gated = await atOpening(a, { schema: { ...kitSchema, target: "kit_item" }, fields: { [EXT_FIELD.id]: choice("o_ext00002") } });
      assert.equal(gated.status, 422);
      assert.deepEqual(gated.body, { error: fieldsGateText(1, 0), code: "FIELDS_INCOMPLETE", missing: [{ field_id: STAND.id, reason: "required" }] });
      assert.deepEqual(await footprint(a), aBefore);

      const aRes = await atOpening(a, {
        sku: "MK-1",
        schema: { ...kitSchema, target: "kit_item" },
        fields: { ...aFields, [BOX_FIELD.id]: choice("o_ext00001") },   // the box's field is not a's
        verdict: { ok: "pass" },
        // Only the box answers decisions' fields: on an item row they are a client bug, and never
        // stored (nor would they count as fills) — whatever they hold.
        decisions: [
          {
            item_id: "123", decision: "packed_anyway", suggested: "pass",
            fields: { [EXT_FIELD.id]: { t: "choice_row", opt: "o_zzzzzzzz", label: "LIE", tone: "pass" } },
          },
          "not a decision",
        ],
      });
      assert.equal(aRes.status, 200, JSON.stringify(aRes.body));
      assert.deepEqual((await storedResults(a))[0].details, {
        sku: "MK-1",
        schema: { route_id: R.kit, v: 1, step_uid: UID.kOpen, target: "kit_item" },
        fields: { [EXT_FIELD.id]: storedChoice(EXT_FIELD, "o_ext00002"), [STAND.id]: storedChoice(STAND, "o_prt00001") },
        verdict: { ok: "pass", suggested: "pass" },
        decisions: [{ item_id: "123", decision: "packed_anyway" }, "not a decision"],
      });

      // b's own route was never published, yet the kit row's version governs it here.
      const bNoSchema = await atOpening(b, { fields: {} });
      assert.equal(bNoSchema.status, 409);
      const bRes = await atOpening(b, { schema: { ...kitSchema, target: "kit_item" }, fields: { [EXT_FIELD.id]: choice("o_ext00001"), [STAND.id]: choice("o_prt00002") } });
      assert.equal(bRes.status, 200, JSON.stringify(bRes.body));
      assert.deepEqual((await storedResults(b))[0].details, {
        schema: { route_id: R.kit, v: 1, step_uid: UID.kOpen, target: "kit_item" },
        fields: { [EXT_FIELD.id]: storedChoice(EXT_FIELD, "o_ext00001") },   // no IN_BOX_ALT group: STAND dropped
        verdict: { suggested: "pass" },
      });

      const boxRes = await atOpening(kit.packageId, {
        schema: { ...kitSchema, target: "box" },
        fields: { [BOX_FIELD.id]: choice("o_ext00003", "פינה מעוכה") },
        verdict: { ok: "fail", note: "" },
      });
      assert.equal(boxRes.status, 200, JSON.stringify(boxRes.body));
      assert.deepEqual((await storedResults(kit.packageId))[0].details, {
        schema: { route_id: R.kit, v: 1, step_uid: UID.kOpen, target: "box" },
        fields: { [BOX_FIELD.id]: storedChoice(BOX_FIELD, "o_ext00003", "פינה מעוכה") },
        verdict: { ok: "fail", note: "", suggested: "fail" },
      });
      assert.equal((await H.routeRow(kit.packageId)).current_route_step, 2);
    });

    it("results: an item inside a kit, at a per-item step, answers its OWN route and version ('item') — being in a kit decides nothing", async () => {
      // The kit's fields are at closing only, so the opening runs as today.
      await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [{ target: "box", fields: [SEAL] }])));
      await publish(R.inBox, config(itemStep(UID.bFunc, [LED, GND])));
      const kit = await createKit([H.ITEM_TYPE_IN_BOX]);
      const [a] = kit.itemIds;
      await openKit(kit);
      assert.equal((await H.routeRow(a)).current_route_step, 2);

      const sf = await stationFields(a, H.STATION_FUNC_A);
      assert.deepEqual(sf.body, {
        mode: "item",
        schema: { route_id: R.inBox, v: 1, step_uid: UID.bFunc, target: "item" },
        fields: [LED, GND],
        gate: GATE_FINISH_ON_REQUIRED,
      });
      await H.startTest({ itemId: a, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() });
      const asKitItem = await submitAt(a, H.STATION_FUNC_A, {
        Details: { schema: { route_id: R.kit, v: 1, step_uid: UID.kClose, target: "kit_item" }, fields: validFields() },
      });
      assert.equal(asKitItem.status, 409);
      const res = await submitAt(a, H.STATION_FUNC_A, { Passed: true, Details: { schema: sf.body.schema, fields: validFields() } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual((await storedResults(a)).at(-1)!.details, {
        schema: { route_id: R.inBox, v: 1, step_uid: UID.bFunc, target: "item" },
        fields: {
          [LED.id]: storedChoice(LED, "o_led00001"),
          [GND.id]: { t: "number", label: GND.label, value: 0.05, unit: "Ω", in_range: true },
        },
        verdict: { suggested: "pass" },
      });
    });

    it("results: at closing a 'packed anyway' decision is checked against that item's groups — normalised, gated, given its own suggested — while every other decision keeps no fields", async () => {
      // Fields at closing only: the opening runs as today.
      await publish(R.kit, config(kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [
        { target: "box", fields: [SEAL] },
        { target: "each_item", fields: [EXT_FIELD] },
        { target: { item_type_id: H.ITEM_TYPE_IN_BOX_ALT }, fields: [CABLE] },
      ])));
      const kit = await createKit([H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT, H.ITEM_TYPE_IN_BOX]);
      const [arrived, packedAnyway, missing] = kit.itemIds;
      await openKit(kit);
      // One item reaches the closing step; the other two leave their route through research.
      await passStep(arrived, H.STATION_FUNC_A);
      await finishThroughResearch(packedAnyway, H.STATION_FUNC_B);
      await finishThroughResearch(missing, H.STATION_FUNC_A);
      const boxRoute = await H.routeRow(kit.packageId);
      assert.equal(boxRoute.current_route_step, 2);
      assert.equal(boxRoute.current_status, H.STATUS.queued, "every item is at closing or finished: the box is queued there");

      await H.startTest({ itemId: kit.packageId, stationId: H.STATION_CLOSE, actionUuid: randomUUID() });
      const sf = await stationFields(kit.packageId, H.STATION_CLOSE);
      assert.equal(sf.body.mode, "package");
      const kitSchema = sf.body.schema;
      assert.deepEqual(kitSchema, { route_id: R.kit, v: 1, step_uid: UID.kClose });
      const atClose = (itemId: number, details: unknown) => submitAt(itemId, H.STATION_CLOSE, { Passed: true, Details: details });

      const arrivedRes = await atClose(arrived, { schema: { ...kitSchema, target: "kit_item" }, fields: { [EXT_FIELD.id]: choice("o_ext00001") } });
      assert.equal(arrivedRes.status, 200, JSON.stringify(arrivedRes.body));

      const boxDetails = (decisions: unknown[]) => ({
        closing: true,
        checks: [true, true, true],
        packed: [String(arrived)],
        schema: { ...kitSchema, target: "box" },
        fields: { [SEAL.id]: { t: "pass_fail", ok: "pass" } },
        verdict: { ok: "pass" },
        decisions,
      });
      const missingDecision = {
        item_id: String(missing), decision: "missing", note: "לא נמצא",
        fields: { [EXT_FIELD.id]: choice("o_ext00001") }, suggested: "pass",   // a client bug: dropped
      };

      // packedAnyway is an IN_BOX_ALT: its type's group is required too, and the gate says whose.
      const boxBefore = await footprint(kit.packageId);
      const gated = await atClose(kit.packageId, boxDetails([
        { item_id: String(packedAnyway), decision: "packed_anyway", note: "", fields: { [EXT_FIELD.id]: choice("o_ext00001") } },
        missingDecision,
      ]));
      assert.equal(gated.status, 422);
      assert.deepEqual(gated.body, {
        error: fieldsGateText(1, 0),
        code: "FIELDS_INCOMPLETE",
        missing: [{ field_id: CABLE.id, reason: "required", item_id: String(packedAnyway) }],
      });
      assert.deepEqual(await footprint(kit.packageId), boxBefore);

      const res = await atClose(kit.packageId, boxDetails([
        {
          item_id: String(packedAnyway), decision: "packed_anyway", note: "נמצא בארגז",
          fields: {
            [EXT_FIELD.id]: { t: "choice_row", label: "LIE", opt: "o_ext00003", opt_label: "LIE", tone: "pass", note: "סדק במסגרת" },
            [CABLE.id]: choice("o_prt00001"),
            f_zzzzzzz1: { t: "text", value: "not in the config" },
          },
          suggested: "pass",
        },
        missingDecision,
      ]));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const closing = (await storedResults(kit.packageId)).at(-1)!;
      assert.deepEqual(closing.details, {
        closing: true,
        checks: [true, true, true],
        packed: [String(arrived)],
        schema: { route_id: R.kit, v: 1, step_uid: UID.kClose, target: "box" },
        fields: { [SEAL.id]: { t: "pass_fail", label: SEAL.label, ok: "pass" } },
        verdict: { ok: "pass", suggested: "pass" },
        decisions: [
          {
            item_id: String(packedAnyway), decision: "packed_anyway", note: "נמצא בארגז",
            fields: {
              [EXT_FIELD.id]: storedChoice(EXT_FIELD, "o_ext00003", "סדק במסגרת"),
              [CABLE.id]: storedChoice(CABLE, "o_prt00001"),
            },
            suggested: "fail",
          },
          { item_id: String(missing), decision: "missing", note: "לא נמצא" },
        ],
      });
      assert.equal((await H.routeRow(kit.packageId)).is_finished, true);
    });

    // -------------------------------------------------------------------------------------
    // HTTP (§3.0, §3.2) — the admin handlers as Next runs them: withAuth's role gates, and the
    // status and body every refusal reaches the client with
    // -------------------------------------------------------------------------------------

    it("http: every station-field write needs a session (401) and FIELDS_EDIT_ROLES (403, naming them) — publish PUBLISH_ROLES — while reads stay open; nothing is written when refused", async () => {
      const id = String(R.fields);
      const rev = await saveDraft(R.fields, config(itemStep(UID.f1, [LED])));
      const writes: { name: string; roles: AppRole[]; call: () => Promise<{ status: number; body: any }> }[] = [
        { name: "POST route", roles: FIELDS_EDIT_ROLES, call: () => httpCall(http.routes.POST, "POST", "/api/settings/testing-routes", {
          body: { item_type_id: ITEM_TYPE_ROUTED, route_number: 1, route_steps: [H.TYPE_FUNC] } }) },
        { name: "PUT route", roles: FIELDS_EDIT_ROLES, call: () => httpCall(http.route.PUT, "PUT", `/api/settings/testing-routes/${id}`, {
          body: { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC] }, params: { id } }) },
        { name: "PUT draft", roles: FIELDS_EDIT_ROLES, call: () => httpCall(http.draft.PUT, "PUT", `/api/settings/testing-routes/${id}/fields/draft`, {
          body: { config: config(itemStep(UID.f1, [LED, GND])), base_rev: rev }, params: { id } }) },
        { name: "DELETE draft", roles: FIELDS_EDIT_ROLES, call: () => httpCall(http.draft.DELETE, "DELETE", `/api/settings/testing-routes/${id}/fields/draft`, {
          body: { base_rev: rev }, params: { id } }) },
        { name: "publish-preview", roles: FIELDS_EDIT_ROLES, call: () => httpCall(http.preview.POST, "POST", "/api/settings/testing-routes/fields/publish-preview", {
          body: { route_ids: [R.fields] } }) },
        { name: "publish", roles: PUBLISH_ROLES, call: () => httpCall(http.publish.POST, "POST", "/api/settings/testing-routes/fields/publish", {
          body: { route_ids: [R.fields], base_revs: { [id]: rev }, apply_mode: "new_only" } }) },
      ];
      const routeBefore = await routeRow(R.fields);

      session = null;
      for (const w of writes) assert.deepEqual(await w.call(), { status: 401, body: { error: "Unauthorized" } }, w.name);
      session = signedIn("storekeeper", "mashan");
      for (const w of writes) assert.deepEqual(await w.call(), { status: 403, body: { error: "Forbidden", required: w.roles } }, w.name);
      assert.deepEqual(await routeRow(R.fields), routeBefore, "nothing written");
      assert.deepEqual(await H.q("SELECT 1 FROM testing_routes WHERE item_type_id = $1", [ITEM_TYPE_ROUTED]), [], "no route created");
      assert.deepEqual(await H.q("SELECT id FROM route_field_versions"), [], "nothing published");

      // Reads are not wrapped: the middleware signs them in, whatever the roles (spec §3.0).
      session = null;
      const list = await httpCall(http.routes.GET, "GET", `/api/settings/testing-routes?itemTypeId=${ITEM_TYPE_FIELDS}&routeNumber=1`);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.map((r: { test_route_id: number; has_draft: boolean }) => [r.test_route_id, r.has_draft]), [[R.fields, true]]);
      const read = await httpCall(http.fields.GET, "GET", `/api/settings/testing-routes/${id}/fields`, { params: { id } });
      assert.equal(read.status, 200);
      assert.deepEqual(read.body.draft, config(itemStep(UID.f1, [LED])));
    });

    it("http: a tester may do every write; open decision §10.2-1 flipped the one-line way (PUBLISH_ROLES = manager) leaves the tester the preview but not the publish, and the manager's publish records who published", async () => {
      session = signedIn("tester");
      const created = await httpCall(http.routes.POST, "POST", "/api/settings/testing-routes", {
        body: { item_type_id: ITEM_TYPE_ROUTED, route_number: 1, route_steps: [H.TYPE_FUNC, H.TYPE_FUNC] },
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.step_uids.length, 2);
      const newId = String(created.body.test_route_id);
      const steps = await httpCall(http.route.PUT, "PUT", `/api/settings/testing-routes/${newId}`, { body: { route_steps: [H.TYPE_FUNC] }, params: { id: newId } });
      assert.equal(steps.status, 200, JSON.stringify(steps.body));
      assert.deepEqual(steps.body.step_uids, [created.body.step_uids[0]]);

      const id = String(R.fields);
      const draftUrl = `/api/settings/testing-routes/${id}/fields/draft`;
      const saved = await httpCall(http.draft.PUT, "PUT", draftUrl, { body: { config: config(itemStep(UID.f1, [LED])), base_rev: 0 }, params: { id } });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.draft_rev, 1);
      const discarded = await httpCall(http.draft.DELETE, "DELETE", draftUrl, { body: { base_rev: 1 }, params: { id } });
      assert.deepEqual(discarded, { status: 200, body: { draft_rev: 2 } });
      const again = await httpCall(http.draft.PUT, "PUT", draftUrl, { body: { config: config(itemStep(UID.f1, [LED, GND])), base_rev: 2 }, params: { id } });
      assert.equal(again.status, 200, JSON.stringify(again.body));
      assert.equal((await routeRow(R.fields)).draft_updated_by, "fields-http", "the session's preferredUsername");

      const previewOf = () => httpCall(http.preview.POST, "POST", "/api/settings/testing-routes/fields/publish-preview", { body: { route_ids: [R.fields] } });
      const preview = await previewOf();
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.deepEqual(preview.body.base_revs, { [id]: 3 });
      const publishBody = { route_ids: [R.fields], base_revs: preview.body.base_revs, apply_mode: "new_only" };

      const decided = [...PUBLISH_ROLES];
      PUBLISH_ROLES.splice(0, PUBLISH_ROLES.length, "manager");
      try {
        assert.deepEqual(
          await httpCall(http.publish.POST, "POST", "/api/settings/testing-routes/fields/publish", { body: publishBody }),
          { status: 403, body: { error: "Forbidden", required: ["manager"] } },
        );
        assert.equal((await previewOf()).status, 200, "the preview stays with FIELDS_EDIT_ROLES");
        session = signedIn("manager");
        const published = await httpCall(http.publish.POST, "POST", "/api/settings/testing-routes/fields/publish", { body: publishBody });
        assert.equal(published.status, 200, JSON.stringify(published.body));
        assert.deepEqual(published.body.versions, { [id]: 1 });
      } finally {
        PUBLISH_ROLES.splice(0, PUBLISH_ROLES.length, ...decided);
      }
      assert.deepEqual(
        await H.one("SELECT published_by, published_by_name FROM route_field_versions WHERE test_route_id = $1 AND version = 1", [R.fields]),
        { published_by: "fields-http", published_by_name: "Fields HTTP" },
      );
    });

    it("http: refusals reach the client with their status and code — a step uid refusal (400 STEP_UID_UNKNOWN), a stale draft (409 DRAFT_CONFLICT with the draft to reload), a lint error (422 with its issues), a bad body or id (400) and a missing route (404)", async () => {
      session = signedIn("tester");
      const id = String(R.fields);
      const routeUrl = `/api/settings/testing-routes/${id}`;
      const draftUrl = `${routeUrl}/fields/draft`;

      const unknown = await httpCall(http.route.PUT, "PUT", routeUrl, {
        body: { route_steps: [H.TYPE_FUNC, H.TYPE_FUNC, H.TYPE_FUNC], step_uids: [UID.f1, UID.f2, "s_zzzzzzzz"] }, params: { id },
      });
      assert.equal(unknown.status, 400);
      assert.deepEqual(Object.keys(unknown.body).sort(), ["code", "error"]);
      assert.equal(unknown.body.code, "STEP_UID_UNKNOWN");
      const missingRoute = await httpCall(http.route.PUT, "PUT", "/api/settings/testing-routes/2147483647", {
        body: { route_steps: [H.TYPE_FUNC] }, params: { id: "2147483647" },
      });
      assert.deepEqual(missingRoute, { status: 404, body: { error: "Route not found" } });

      const rev = await saveDraft(R.fields, config(itemStep(UID.f1, [LED])));
      const stale = await httpCall(http.draft.PUT, "PUT", draftUrl, { body: { config: config(itemStep(UID.f1, [GND])), base_rev: rev - 1 }, params: { id } });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, "DRAFT_CONFLICT");
      assert.deepEqual(stale.body.draft, config(itemStep(UID.f1, [LED])));
      assert.equal(stale.body.draft_rev, rev);
      assert.equal(stale.body.draft_updated_by, ACTOR.username);
      assert.equal(typeof stale.body.draft_updated_at, "string");

      const shape = await httpCall(http.draft.PUT, "PUT", draftUrl, { body: { config: { schema: 2, steps: {} }, base_rev: rev }, params: { id } });
      assert.deepEqual([shape.status, shape.body.code, shape.body.path], [400, "SHAPE_INVALID", "$"]);
      const notJson = await httpCall(http.draft.PUT, "PUT", draftUrl, { raw: "{not json", params: { id } });
      assert.deepEqual([notJson.status, notJson.body.code], [400, "INVALID_BODY"]);

      await saveDraft(R.second, config(itemStep(UID.s1, [{ ...INSULATION, label: " " }])));
      const lint = await httpCall(http.preview.POST, "POST", "/api/settings/testing-routes/fields/publish-preview", { body: { route_ids: [R.second] } });
      assert.equal(lint.status, 422);
      assert.equal(lint.body.code, "LINT_ERRORS");
      assert.ok(lint.body.issues.some((i: RouteIssue) => i.route_id === R.second && i.code === "FIELD_LABEL_EMPTY" && i.level === "error"));

      for (const bad of ["abc", "0", "3000000000"]) {
        const r = await httpCall(http.fields.GET, "GET", `/api/settings/testing-routes/${bad}/fields`, { params: { id: bad } });
        assert.deepEqual([r.status, r.body.code], [400, "INVALID_ID"], bad);
      }
      const gone = await httpCall(http.fields.GET, "GET", "/api/settings/testing-routes/2147483647/fields", { params: { id: "2147483647" } });
      assert.deepEqual(gone, { status: 404, body: { error: "Route 2147483647 not found", code: "ROUTE_NOT_FOUND", route_id: 2147483647 } });
    });
  },
);
