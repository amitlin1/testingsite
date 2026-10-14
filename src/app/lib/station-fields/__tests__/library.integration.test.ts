// Integration suite for the station-fields libraries (route-fields spec §3.2 option-lists /
// field-sets rows and "ספירת שימוש", §5.7 "החל על השדה", §5.9 "שמירה כגרסה"; artboards 4 and 8),
// against a real database:
//   - CRUD: create (version 1), list (archived hidden), save as a new version, base_version
//     conflicts, strict bodies;
//   - usage: counted over every route's draft AND its latest published version, a place once;
//   - propagate: drafts only — published versions never change, draft_rev is bumped — and a field
//     set's cells get fresh field ids that stay unique in their step;
//   - delete: 409 IN_USE while used, otherwise archived;
//   - HTTP: the handlers' role gates, status codes and bodies; a real 500, never an empty list.
//
// The rules live in library.ts, and most tests call it directly. The write handlers are wrapped
// in withAuth; the HTTP test reaches them as fields.integration.test.ts does — the root auth.ts is
// replaced in require.cache before anything loads it, with an auth() answering `session`.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database carrying the station-fields
// migration; without it the describe block is skipped. It borrows the write-path harness: setup()
// points DATABASE_URL at the scratch database before anything imports the Prisma client and holds
// the ledger suites' advisory lock for the life of this file; resetDb() wipes the operational
// tables (testing_routes with CASCADE, so route_field_versions too). option_lists and field_sets
// survive resetDb, so this suite empties them before every test and once more at the end.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import type { AppRole } from "@/lib/auth/roles";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { AdminFieldsError } from "../admin";
import type { FieldSetJson, LibraryUseJson, OptionListJson } from "../admin-types";
import type { FieldSetView, LibraryUse, OptionListView } from "../library";
import { FIELDS_EDIT_ROLES } from "../roles";
import { ID_PATTERNS } from "../schema";
import type { ChoiceOption, Field, FieldGroup, RouteFieldsConfig, StepConfig, Tone } from "../schema";

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
/** true only when X and Y are the same type. */
type Equal<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false;
const LIST_MATCHES_WIRE: Equal<Wire<OptionListView>, OptionListJson> = true;
const SET_MATCHES_WIRE: Equal<Wire<FieldSetView>, FieldSetJson> = true;
const USE_MATCHES_WIRE: Equal<Wire<LibraryUse>, LibraryUseJson> = true;

// ---------------------------------------------------------------------------
// Fixture. On top of the write-path world (station types 10 INTAKE and 40 CLOSE package-level,
// 20 FUNC per item; the kit PACKAGE_CLOSE = [INTAKE, CLOSE]) this suite adds three plain item
// types, each with a one- or two-step FUNC route, and gives the kit's route step uids.
// ---------------------------------------------------------------------------

const ITEM_TYPE_ALPHA = 11;
const ITEM_TYPE_BETA = 12;
const ITEM_TYPE_GAMMA = 13;

const UID = {
  a1: "s_alpha001", a2: "s_alpha002",      // ALPHA = [FUNC, FUNC]
  b1: "s_beta0001",                        // BETA  = [FUNC]
  g1: "s_gamma001",                        // GAMMA = [FUNC]
  kOpen: "s_kopen001", kClose: "s_kclose01", // the kit's route
} as const;

/** test_route_id of each route, and the library rows, resolved after every reset. */
const R = { alpha: 0, beta: 0, gamma: 0, kit: 0 };
const LIB = { L: 0, M: 0, S: 0 };

const ACTOR = { username: "library-suite", name: "Library Suite" };

// ---- fields ---------------------------------------------------------------------------------------
const opt = (id: string, label: string, tone: Tone): ChoiceOption => ({ id, label, tone });
const LED_OPTIONS = [opt("o_led00001", "תקין", "pass"), opt("o_led00002", "מהבהבת", "warn"), opt("o_led00003", "לא דולקת", "fail"), opt("o_led00004", "לא נבדק", "neutral")];
const EXT_OPTIONS = [opt("o_ext00001", "ללא פגמים", "pass"), opt("o_ext00002", "שריטות קלות", "warn"), opt("o_ext00003", "שבר/סדק", "fail"), opt("o_ext00004", "לכלוך", "warn")];
/** Version 2 of the list L: one option renamed, one added, one gone. */
const LED_OPTIONS_V2 = [opt("o_led00001", "תקין", "pass"), opt("o_led00003", "כבויה", "fail"), opt("o_new00001", "חלשה", "warn")];

const choice = (id: string, label: string, options: ChoiceOption[]): Field =>
  ({ id, type: "choice_row", label, required: true, notes: "required_on_fail", options });
const LED = choice("f_led00001", "נורית מתח", LED_OPTIONS);
const EXT_B = choice("f_extb0001", "מצב חיצוני", LED_OPTIONS);
const EXT_G = choice("f_extg0001", "מצב חיצוני", LED_OPTIONS);
const LED_G = choice("f_ledg0001", "נורית", EXT_OPTIONS);
const BOX = choice("f_box00001", "שלמות הקופסה", LED_OPTIONS);
const EACH = choice("f_each0001", "הפריט ארוז במקומו", LED_OPTIONS);
const CABLE = choice("f_cable001", "כבל", LED_OPTIONS);
const GND: Field = { id: "f_gnd00001", type: "number", label: "התנגדות הארקה", required: true, notes: "optional", unit: "Ω", max: 0.1, out_of_range_fail: true };
const OWN1: Field = { id: "f_own00001", type: "pass_fail", label: "מדבקת סגירה", required: true, notes: "optional" };
const OWN2: Field = { id: "f_own00002", type: "text", label: "הערת סגירה", required: false, notes: "off" };

/** The set S, version 1. */
const S_EXT = choice("f_sext0001", "מצב חיצוני", EXT_OPTIONS);
const S_GND: Field = { ...GND, id: "f_sgnd0001" };
/** The set S, version 2: a section header, a new field, S_EXT renamed, S_GND as it was. */
const S_SECTION: Field = { id: "f_ssec0001", type: "section", label: "הפעלה" };
const S_NEW: Field = { id: "f_snew0001", type: "pass_fail", label: "ניקיון", required: false, notes: "optional" };
const S_EXT_V2 = choice("f_sext0001", "מצב חיצוני בסגירה", EXT_OPTIONS);
const S_FIELDS_V2 = [S_SECTION, S_NEW, S_EXT_V2, S_GND];

const linkTo = (f: Field, id: number, ver = 1): Field => ({ ...f, list_ref: { id, ver } } as Field);
const fromSet = (f: Field, id: number, ver = 1): Field => ({ ...f, from_set: { id, ver } } as Field);
/** The set S applied to a cell under other ids (the ids of a step are its own). */
const setCopy = (f: Field, id: string, ver = 1): Field => fromSet({ ...f, id } as Field, LIB.S, ver);

// ---- configs --------------------------------------------------------------------------------------
const itemStep = (uid: string, fields: Field[]): StepConfig =>
  ({ uid, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item", groups: [{ target: "item", fields }] });
const kitStep = (uid: string, typeId: number, label: string, groups: FieldGroup[]): StepConfig =>
  ({ uid, station_type_id: typeId, station_label: label, scope: "package", groups });
const config = (...steps: StepConfig[]): RouteFieldsConfig =>
  ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });

/** ALPHA: LED linked to L at its first step (plus `extra`), the set S at its second. */
const alphaConfig = (extra: Field[] = []) => config(
  itemStep(UID.a1, [linkTo(LED, LIB.L), ...extra]),
  itemStep(UID.a2, [fromSet(S_EXT, LIB.S), fromSet(S_GND, LIB.S)]),
);
/** The kit's draft: L in three cells of the opening step; the set S in two cells of the closing
 *  step, between fields of the cell's own. */
const kitConfig = () => config(
  kitStep(UID.kOpen, H.TYPE_INTAKE, "INTAKE", [
    { target: "box", fields: [linkTo(BOX, LIB.L)] },
    { target: "each_item", fields: [linkTo(EACH, LIB.L)] },
    { target: { item_type_id: H.ITEM_TYPE_IN_BOX }, fields: [linkTo(CABLE, LIB.L)] },
  ]),
  kitStep(UID.kClose, H.TYPE_CLOSE, "CLOSE", [
    { target: "box", fields: [OWN1, setCopy(S_EXT, "f_kbx00001"), setCopy(S_GND, "f_kbx00002"), OWN2] },
    { target: "each_item", fields: [setCopy(S_EXT, "f_kea00001"), setCopy(S_GND, "f_kea00002")] },
  ]),
);

// ---- the session withAuth sees ----------------------------------------------------------------------
/** What the stubbed auth() answers: null = signed out. Set by the HTTP test. */
let session: unknown = null;

const signedIn = (...roles: AppRole[]) => ({
  user: { preferredUsername: "library-http", displayName: "Library HTTP", name: "library-http" },
  roles,
});

/** Replaces the root auth.ts in require.cache with a module whose auth() answers `session` (as
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
  "station fields — option lists and field sets: CRUD, usage over drafts and published versions, propagate to drafts, delete",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — library integration suite skipped" },
  () => {
    let A: typeof import("../admin");
    let Lib: typeof import("../library");
    let prisma: (typeof import("../../prisma"))["prisma"];
    let http: {
      lists: typeof import("../../../api/settings/option-lists/route");
      list: typeof import("../../../api/settings/option-lists/[id]/route");
      listUsage: typeof import("../../../api/settings/option-lists/[id]/usage/route");
      listPropagate: typeof import("../../../api/settings/option-lists/[id]/propagate/route");
      sets: typeof import("../../../api/settings/field-sets/route");
      set: typeof import("../../../api/settings/field-sets/[id]/route");
      setUsage: typeof import("../../../api/settings/field-sets/[id]/usage/route");
      setPropagate: typeof import("../../../api/settings/field-sets/[id]/propagate/route");
    };

    const emptyLibraries = () => H.q("TRUNCATE option_lists, field_sets RESTART IDENTITY");

    before(async () => {
      // Before anything can load auth.ts.
      stubAuth();
      // MUST come next: it points DATABASE_URL at the scratch database before anything imports
      // the Prisma client, and takes the advisory lock.
      await H.setup();
      A = await import("../admin");
      Lib = await import("../library");
      prisma = (await import("../../prisma")).prisma;
      http = {
        lists: await import("../../../api/settings/option-lists/route"),
        list: await import("../../../api/settings/option-lists/[id]/route"),
        listUsage: await import("../../../api/settings/option-lists/[id]/usage/route"),
        listPropagate: await import("../../../api/settings/option-lists/[id]/propagate/route"),
        sets: await import("../../../api/settings/field-sets/route"),
        set: await import("../../../api/settings/field-sets/[id]/route"),
        setUsage: await import("../../../api/settings/field-sets/[id]/usage/route"),
        setPropagate: await import("../../../api/settings/field-sets/[id]/propagate/route"),
      };
    });
    after(async () => {
      await emptyLibraries();
      await H.teardown();
    });
    beforeEach(async () => {
      session = null;
      await H.resetDb();
      await emptyLibraries();
      await H.q(
        `INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'ALPHA', false), ($2, 'BETA', false), ($3, 'GAMMA', false)`,
        [ITEM_TYPE_ALPHA, ITEM_TYPE_BETA, ITEM_TYPE_GAMMA],
      );
      R.kit = await giveUids(H.ITEM_TYPE_PACKAGE_CLOSE, [UID.kOpen, UID.kClose]);
      R.alpha = await insertRoute(ITEM_TYPE_ALPHA, [H.TYPE_FUNC, H.TYPE_FUNC], [UID.a1, UID.a2]);
      R.beta = await insertRoute(ITEM_TYPE_BETA, [H.TYPE_FUNC], [UID.b1]);
      R.gamma = await insertRoute(ITEM_TYPE_GAMMA, [H.TYPE_FUNC], [UID.g1]);
      LIB.L = LIB.M = LIB.S = 0;
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
        `UPDATE testing_routes SET step_uids = $2::text[] WHERE item_type_id = $1 AND route_number = 1 RETURNING test_route_id`,
        [itemTypeId, uids],
      );
      return row.test_route_id;
    }

    type RouteState = { fields_draft: RouteFieldsConfig | null; draft_rev: number; fields_version: number; draft_updated_by: string | null };

    async function routeState(routeId: number): Promise<RouteState> {
      return H.one<RouteState>(
        "SELECT fields_draft, draft_rev, fields_version, draft_updated_by FROM testing_routes WHERE test_route_id = $1",
        [routeId],
      );
    }

    /** Every route's draft_rev, by id. */
    async function revs(): Promise<Record<number, number>> {
      const rows = await H.q<{ test_route_id: number; draft_rev: number }>("SELECT test_route_id, draft_rev FROM testing_routes");
      return Object.fromEntries(rows.map((r) => [r.test_route_id, r.draft_rev]));
    }

    /** Everything published, and every route's published pointer: what propagate must never touch. */
    async function publishedState(): Promise<unknown> {
      return {
        versions: await H.q("SELECT id, test_route_id, version, config, changes, published_at FROM route_field_versions ORDER BY id"),
        pointers: await H.q("SELECT test_route_id, fields_version FROM testing_routes ORDER BY test_route_id"),
      };
    }

    async function saveDraft(routeId: number, cfg: RouteFieldsConfig): Promise<number> {
      const { draft_rev } = await routeState(routeId);
      return (await A.saveFieldsDraft(prisma, routeId, { config: cfg, base_rev: draft_rev }, ACTOR)).draft_rev;
    }

    async function publish(routeId: number, cfg: RouteFieldsConfig): Promise<void> {
      const rev = await saveDraft(routeId, cfg);
      await A.publishFields(prisma, { route_ids: [routeId], base_revs: { [routeId]: rev }, apply_mode: "new_only" }, ACTOR);
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

    /** One handler call as Next makes it: a JSON body (or `raw` text), the dynamic route's params. */
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

    /** A server value as the client receives it. `any`, like an HTTP body: assert.deepEqual would
     *  otherwise narrow the body it is compared with. */
    const json = (v: unknown): any => JSON.parse(JSON.stringify(v));

    /**
     * The common world of the usage / propagate / delete tests:
     *   L "מצב נורית" — ALPHA's first step (published, and again in its draft), BETA (published
     *     only: its draft dropped the field), GAMMA (published, no draft), the kit's draft (box,
     *     each_item, the IN_BOX group of the opening step);
     *   M — one field of GAMMA's published version;
     *   S (version 1) — ALPHA's second step (published and draft), the kit's closing step (box and
     *     each_item, draft only).
     */
    async function seedWorld(): Promise<void> {
      LIB.L = (await Lib.createOptionList(prisma, { name: "מצב נורית", options: LED_OPTIONS }, ACTOR)).id;
      LIB.M = (await Lib.createOptionList(prisma, { name: "מצב חיצוני", options: EXT_OPTIONS }, ACTOR)).id;
      LIB.S = (await Lib.createFieldSet(prisma, { name: "בדיקה חזותית בסיסית", fields: [S_EXT, S_GND] }, ACTOR)).id;
      await publish(R.alpha, alphaConfig());
      await saveDraft(R.alpha, alphaConfig([GND]));
      await publish(R.beta, config(itemStep(UID.b1, [linkTo(EXT_B, LIB.L)])));
      await saveDraft(R.beta, config(itemStep(UID.b1, [GND])));
      await publish(R.gamma, config(itemStep(UID.g1, [linkTo(EXT_G, LIB.L), linkTo(LED_G, LIB.M)])));
      await saveDraft(R.kit, kitConfig());
    }

    /** The fields of one cell of a config. */
    function cell(cfg: RouteFieldsConfig | null, uid: string, groupIndex: number): Field[] {
      assert.ok(cfg, "a config");
      const step = cfg.steps[uid];
      assert.ok(step, `step ${uid}`);
      return step.groups[groupIndex].fields;
    }
    const stepFieldIds = (cfg: RouteFieldsConfig | null, uid: string) => {
      assert.ok(cfg);
      return cfg.steps[uid].groups.flatMap((g) => g.fields.map((f) => f.id));
    };

    // -------------------------------------------------------------------------------------
    // CRUD
    // -------------------------------------------------------------------------------------

    it("option lists: POST stores the trimmed name at version 1, GET lists it with its usage, PUT saves version + 1, and a stale base_version is a 409 VERSION_CONFLICT carrying the current row", async () => {
      const created = await Lib.createOptionList(prisma, { name: "  מצב נורית  ", options: LED_OPTIONS }, ACTOR);
      assert.ok(created.updated_at instanceof Date);
      const { updated_at: _at, ...rest } = created;
      assert.deepEqual(rest, {
        id: created.id, name: "מצב נורית", options: LED_OPTIONS, version: 1, updated_by: ACTOR.username, usage: { fields: 0, routes: 0 },
      });
      const second = await Lib.createOptionList(prisma, { name: "מצב חיצוני", options: EXT_OPTIONS }, ACTOR);
      assert.deepEqual(await Lib.listOptionLists(prisma), [created, second], "ascending id");

      assert.deepEqual(
        await Lib.updateOptionList(prisma, created.id, { name: "מצב נורית חדש", options: LED_OPTIONS_V2, base_version: 1 }, { username: "other", name: null }),
        { version: 2, linked: [] },
      );
      const [now] = await Lib.listOptionLists(prisma);
      assert.deepEqual([now.name, now.options, now.version, now.updated_by], ["מצב נורית חדש", LED_OPTIONS_V2, 2, "other"]);
      assert.ok(now.updated_at.getTime() >= created.updated_at.getTime());

      const stale = await rejectsAdmin(
        Lib.updateOptionList(prisma, created.id, { name: "x", options: LED_OPTIONS, base_version: 1 }, ACTOR),
        409,
        "VERSION_CONFLICT",
      );
      assert.deepEqual(stale.extra, { current: now });
      assert.deepEqual((await Lib.listOptionLists(prisma))[0], now, "nothing written");
    });

    it("field sets: POST stores version 1 without any from_set (a template links to nothing), GET lists it, PUT saves version + 1, and a stale base_version is a 409 VERSION_CONFLICT carrying the current row", async () => {
      const created = await Lib.createFieldSet(prisma, { name: " ערכה חדשה ", fields: [fromSet(S_EXT, 99, 3), S_GND, S_SECTION] }, ACTOR);
      assert.ok(created.created_at instanceof Date && created.updated_at instanceof Date);
      assert.deepEqual([created.name, created.fields, created.version, created.updated_by, created.usage], [
        "ערכה חדשה", [S_EXT, S_GND, S_SECTION], 1, ACTOR.username, { cells: 0, outdated: 0 },
      ]);
      const stored = await H.one<{ fields: Field[] }>("SELECT fields FROM field_sets WHERE id = $1", [created.id]);
      assert.deepEqual(stored.fields, [S_EXT, S_GND, S_SECTION], "stored without from_set");
      assert.deepEqual(await Lib.listFieldSets(prisma), [created]);

      assert.deepEqual(await Lib.updateFieldSet(prisma, created.id, { name: "ערכה חדשה", fields: S_FIELDS_V2, base_version: 1 }, ACTOR), { version: 2 });
      const [now] = await Lib.listFieldSets(prisma);
      assert.deepEqual([now.fields, now.version], [S_FIELDS_V2, 2]);
      assert.deepEqual(now.created_at, created.created_at, "created_at stays");

      const stale = await rejectsAdmin(Lib.updateFieldSet(prisma, created.id, { name: "x", fields: [], base_version: 1 }, ACTOR), 409, "VERSION_CONFLICT");
      assert.deepEqual(stale.extra, { current: now });
      assert.deepEqual(await Lib.listFieldSets(prisma), [now], "nothing written");
    });

    it("bodies are parsed strictly: a 400 with its code (and the path of a shape error) for every bad member, a 400 INVALID_ID / 404 for the path id — and nothing is written", async () => {
      const list = await Lib.createOptionList(prisma, { name: "רשימה", options: LED_OPTIONS }, ACTOR);
      const set = await Lib.createFieldSet(prisma, { name: "ערכה", fields: [S_EXT] }, ACTOR);
      const rowsBefore = await H.q("SELECT * FROM option_lists UNION ALL SELECT id, name, fields, version, archived, created_at, updated_at, updated_by FROM field_sets ORDER BY 1, 2");

      await rejectsAdmin(Lib.createOptionList(prisma, [] as never, ACTOR), 400, "INVALID_BODY");
      for (const name of [undefined, "", "   ", 5, "x".repeat(101)]) {
        await rejectsAdmin(Lib.createOptionList(prisma, { name, options: LED_OPTIONS }, ACTOR), 400, "NAME_INVALID");
        await rejectsAdmin(Lib.createFieldSet(prisma, { name, fields: [] }, ACTOR), 400, "NAME_INVALID");
        await rejectsAdmin(Lib.updateOptionList(prisma, list.id, { name, options: LED_OPTIONS, base_version: 1 }, ACTOR), 400, "NAME_INVALID");
      }
      for (const [options, at] of [
        [undefined, "$.options"],
        ["x", "$.options"],
        [Array.from({ length: 13 }, (_, i) => opt(`o_many${String(i).padStart(4, "0")}`, "א", "pass")), "$.options"],
        [[{ id: "bad", label: "א", tone: "pass" }], "$.options[0]"],
        [[opt("o_aaaaaaaa", "א", "red" as Tone)], "$.options[0]"],
        [[opt("o_aaaaaaaa", "א", "pass"), opt("o_aaaaaaaa", "ב", "fail")], "$.options[1]"],
      ] as const) {
        const e = await rejectsAdmin(Lib.createOptionList(prisma, { name: "ok", options }, ACTOR), 400, "SHAPE_INVALID");
        assert.equal(e.extra.path, at, JSON.stringify(options));
      }
      for (const [fields, at] of [
        [undefined, "$.fields"],
        [{}, "$.fields"],
        [[{ ...S_GND, type: "nope" }], "$.fields[0]"],
        [[S_GND, S_GND], "$.fields[1]"],
      ] as const) {
        const e = await rejectsAdmin(Lib.createFieldSet(prisma, { name: "ok", fields }, ACTOR), 400, "SHAPE_INVALID");
        assert.equal(e.extra.path, at, JSON.stringify(fields));
      }
      for (const base_version of [undefined, null, 0, "1", 1.5, -1]) {
        await rejectsAdmin(Lib.updateOptionList(prisma, list.id, { name: "ok", options: LED_OPTIONS, base_version }, ACTOR), 400, "INVALID_BODY");
        await rejectsAdmin(Lib.updateFieldSet(prisma, set.id, { name: "ok", fields: [], base_version }, ACTOR), 400, "INVALID_BODY");
      }
      for (const targets of ["x", {}, [{}], [{ route_id: R.alpha, step_uid: "bad", field_id: "f_aaaaaaaa" }],
        [{ route_id: 0, step_uid: UID.a1, field_id: "f_aaaaaaaa" }], [{ route_id: R.alpha, step_uid: UID.a1, field_id: "x" }],
        Array.from({ length: 1001 }, () => ({ route_id: R.alpha, step_uid: UID.a1, field_id: "f_aaaaaaaa" }))]) {
        await rejectsAdmin(Lib.propagateOptionList(prisma, list.id, { targets }, ACTOR), 400, "INVALID_BODY");
        await rejectsAdmin(Lib.propagateFieldSet(prisma, set.id, { targets }, ACTOR), 400, "INVALID_BODY");
      }
      await rejectsAdmin(Lib.propagateOptionList(prisma, list.id, "x" as never, ACTOR), 400, "INVALID_BODY");

      for (const id of [Number.NaN, 0, -1, 3_000_000_000]) {
        await rejectsAdmin(Lib.updateOptionList(prisma, id, { name: "ok", options: [], base_version: 1 }, ACTOR), 400, "INVALID_ID");
        await rejectsAdmin(Lib.deleteOptionList(prisma, id, ACTOR), 400, "INVALID_ID");
        await rejectsAdmin(Lib.optionListUsage(prisma, id), 400, "INVALID_ID");
        await rejectsAdmin(Lib.propagateOptionList(prisma, id, {}, ACTOR), 400, "INVALID_ID");
        await rejectsAdmin(Lib.updateFieldSet(prisma, id, { name: "ok", fields: [], base_version: 1 }, ACTOR), 400, "INVALID_ID");
        await rejectsAdmin(Lib.deleteFieldSet(prisma, id, ACTOR), 400, "INVALID_ID");
        await rejectsAdmin(Lib.fieldSetUsage(prisma, id), 400, "INVALID_ID");
        await rejectsAdmin(Lib.propagateFieldSet(prisma, id, {}, ACTOR), 400, "INVALID_ID");
      }
      const missing = 2147483647;
      const gone = await rejectsAdmin(Lib.updateOptionList(prisma, missing, { name: "ok", options: [], base_version: 1 }, ACTOR), 404, "OPTION_LIST_NOT_FOUND");
      assert.deepEqual(gone.extra, { id: missing });
      await rejectsAdmin(Lib.propagateOptionList(prisma, missing, {}, ACTOR), 404, "OPTION_LIST_NOT_FOUND");
      await rejectsAdmin(Lib.optionListUsage(prisma, missing), 404, "OPTION_LIST_NOT_FOUND");
      await rejectsAdmin(Lib.updateFieldSet(prisma, missing, { name: "ok", fields: [], base_version: 1 }, ACTOR), 404, "FIELD_SET_NOT_FOUND");
      await rejectsAdmin(Lib.deleteFieldSet(prisma, missing, ACTOR), 404, "FIELD_SET_NOT_FOUND");

      // A name of exactly 100 characters, and targets null / [], are fine.
      assert.deepEqual(await Lib.propagateOptionList(prisma, list.id, { targets: null }, ACTOR), { updated_drafts: 0 });
      assert.deepEqual(await Lib.propagateFieldSet(prisma, set.id, { targets: [] }, ACTOR), { updated_drafts: 0 });
      const rowsAfter = await H.q("SELECT * FROM option_lists UNION ALL SELECT id, name, fields, version, archived, created_at, updated_at, updated_by FROM field_sets ORDER BY 1, 2");
      assert.deepEqual(rowsAfter, rowsBefore, "nothing written by a refused call");
      const long = await Lib.createOptionList(prisma, { name: "x".repeat(100), options: [] }, ACTOR);
      assert.equal(long.name.length, 100);
    });

    // -------------------------------------------------------------------------------------
    // Usage
    // -------------------------------------------------------------------------------------

    it("usage: counted over every route's draft AND its latest published version, a place once per route (the draft's when both hold it), with the labels of artboard 8's chips", async () => {
      await seedWorld();
      assert.ok(R.kit < R.alpha && R.alpha < R.beta && R.beta < R.gamma);

      const lists = await Lib.listOptionLists(prisma);
      assert.deepEqual(lists.map((l) => [l.id, l.usage]), [
        [LIB.L, { fields: 6, routes: 4 }],   // kit ×3 + ALPHA (draft = published) + BETA (published only) + GAMMA
        [LIB.M, { fields: 1, routes: 1 }],
      ]);
      const kitUse = (step_uid: string, target: LibraryUse["target"], field_id: string, item_label: string, station_label: string, ver = 1): LibraryUse =>
        ({ route_id: R.kit, step_uid, target, field_id, ver, in: "draft", kit_desc: "PACKAGE_CLOSE", station_label, item_label });
      const itemUse = (route_id: number, step_uid: string, field_id: string, where: "draft" | "published", item_label: string, ver = 1): LibraryUse =>
        ({ route_id, step_uid, target: "item", field_id, ver, in: where, kit_desc: null, station_label: "FUNC", item_label });
      assert.deepEqual(await Lib.optionListUsage(prisma, LIB.L), [
        kitUse(UID.kOpen, "box", BOX.id, "הקופסה", "INTAKE"),
        kitUse(UID.kOpen, "each_item", EACH.id, "כל פריט במארז", "INTAKE"),
        kitUse(UID.kOpen, { item_type_id: H.ITEM_TYPE_IN_BOX }, CABLE.id, "IN_BOX", "INTAKE"),
        itemUse(R.alpha, UID.a1, LED.id, "draft", "ALPHA"),
        itemUse(R.beta, UID.b1, EXT_B.id, "published", "BETA"),
        itemUse(R.gamma, UID.g1, EXT_G.id, "published", "GAMMA"),
      ]);
      assert.deepEqual(await Lib.optionListUsage(prisma, LIB.M), [itemUse(R.gamma, UID.g1, LED_G.id, "published", "GAMMA")]);

      // The set: one cell per group holding its fields, at the first of them.
      assert.deepEqual((await Lib.listFieldSets(prisma)).map((s) => [s.id, s.usage]), [[LIB.S, { cells: 3, outdated: 0 }]]);
      assert.deepEqual(await Lib.fieldSetUsage(prisma, LIB.S), [
        kitUse(UID.kClose, "box", "f_kbx00001", "הקופסה", "CLOSE"),
        kitUse(UID.kClose, "each_item", "f_kea00001", "כל פריט במארז", "CLOSE"),
        itemUse(R.alpha, UID.a2, S_EXT.id, "draft", "ALPHA"),
      ]);

      // "שמירה כגרסה 2": every cell is now behind; a cell whose draft took the new version is not,
      // and a cell holding the set's fields at mixed versions counts as its oldest.
      assert.deepEqual(await Lib.updateFieldSet(prisma, LIB.S, { name: "בדיקה חזותית בסיסית", fields: [S_EXT, S_GND], base_version: 1 }, ACTOR), { version: 2 });
      assert.deepEqual((await Lib.listFieldSets(prisma))[0].usage, { cells: 3, outdated: 3 });
      const kit = (await routeState(R.kit)).fields_draft!;
      const [kitBox, kitEach] = kit.steps[UID.kClose].groups;
      kitBox.fields = kitBox.fields.map((f) => (f.type !== "section" && f.from_set ? { ...f, from_set: { id: LIB.S, ver: 2 } } : f));
      kitEach.fields = [kitEach.fields[0], { ...kitEach.fields[1], from_set: { id: LIB.S, ver: 2 } } as Field];
      await saveDraft(R.kit, kit);
      assert.deepEqual((await Lib.listFieldSets(prisma))[0].usage, { cells: 3, outdated: 2 });
      assert.deepEqual((await Lib.fieldSetUsage(prisma, LIB.S)).map((u) => [u.target, u.ver]), [["box", 2], ["each_item", 1], ["item", 1]]);

      // A route's discarded draft leaves only its published places.
      await A.discardFieldsDraft(prisma, R.kit, { base_rev: (await routeState(R.kit)).draft_rev }, ACTOR);
      assert.deepEqual((await Lib.listOptionLists(prisma))[0].usage, { fields: 3, routes: 3 });
      // The station label is the live station type's; a step that left the route keeps the label
      // its config recorded.
      await H.q("UPDATE test_stations_type SET test_type_desc = 'FUNC-RENAMED' WHERE test_station_type_id = $1", [H.TYPE_FUNC]);
      await H.q("UPDATE testing_routes SET route_steps = ARRAY[$2::int], step_uids = ARRAY[$3::text] WHERE test_route_id = $1", [R.alpha, H.TYPE_FUNC, UID.a1]);
      const alphaList = (await Lib.optionListUsage(prisma, LIB.L)).find((u) => u.route_id === R.alpha);
      assert.deepEqual([alphaList?.step_uid, alphaList?.station_label], [UID.a1, "FUNC-RENAMED"]);
      const alphaSet = (await Lib.fieldSetUsage(prisma, LIB.S)).find((u) => u.route_id === R.alpha);
      assert.deepEqual([alphaSet?.step_uid, alphaSet?.station_label], [UID.a2, "FUNC"]);
    });

    // -------------------------------------------------------------------------------------
    // Propagate
    // -------------------------------------------------------------------------------------

    it("option list: PUT answers every linked place; propagate gives each linked field the current options (ids included) and list_ref.ver in its route's DRAFT — from the published config when there is no draft — bumps draft_rev once, never touches a published version, and a second run writes nothing", async () => {
      await seedWorld();
      const saved = await Lib.updateOptionList(prisma, LIB.L, { name: "מצב נורית", options: LED_OPTIONS_V2, base_version: 1 }, ACTOR);
      assert.deepEqual(saved, {
        version: 2,
        linked: [
          { route_id: R.kit, step_uid: UID.kOpen, field_id: BOX.id },
          { route_id: R.kit, step_uid: UID.kOpen, field_id: EACH.id },
          { route_id: R.kit, step_uid: UID.kOpen, field_id: CABLE.id },
          { route_id: R.alpha, step_uid: UID.a1, field_id: LED.id },
          { route_id: R.beta, step_uid: UID.b1, field_id: EXT_B.id },
          { route_id: R.gamma, step_uid: UID.g1, field_id: EXT_G.id },
        ],
      });
      const published = await publishedState();
      const before = await revs();
      const kitBefore = (await routeState(R.kit)).fields_draft!;
      const alphaBefore = (await routeState(R.alpha)).fields_draft!;
      assert.equal((await routeState(R.gamma)).fields_draft, null, "GAMMA has no draft yet");

      // BETA's draft no longer has the field: the draft is what propagate starts from, so it is
      // not written.
      assert.deepEqual(await Lib.propagateOptionList(prisma, LIB.L, {}, ACTOR), { updated_drafts: 3 });
      assert.deepEqual(await publishedState(), published, "published versions and pointers unchanged");
      const after = await revs();
      for (const id of Object.keys(before).map(Number)) {
        const bumped = id === R.kit || id === R.alpha || id === R.gamma;
        assert.equal(after[id], before[id] + (bumped ? 1 : 0), `route ${id}`);
      }

      const v2 = (f: Field) => ({ ...f, options: LED_OPTIONS_V2, list_ref: { id: LIB.L, ver: 2 } });
      const kit = await routeState(R.kit);
      assert.equal(kit.draft_updated_by, ACTOR.username);
      assert.deepEqual(kit.fields_draft, config(
        kitStep(UID.kOpen, H.TYPE_INTAKE, "INTAKE", [
          { target: "box", fields: [v2(BOX)] },
          { target: "each_item", fields: [v2(EACH)] },
          { target: { item_type_id: H.ITEM_TYPE_IN_BOX }, fields: [v2(CABLE)] },
        ]),
        kitBefore.steps[UID.kClose],
      ));
      assert.deepEqual((await routeState(R.alpha)).fields_draft, config(itemStep(UID.a1, [v2(LED), GND]), alphaBefore.steps[UID.a2]));
      assert.deepEqual((await routeState(R.gamma)).fields_draft, config(itemStep(UID.g1, [v2(EXT_G), linkTo(LED_G, LIB.M)])),
        "a draft made from the published config; the field of the other list untouched");
      assert.deepEqual((await routeState(R.beta)).fields_draft, config(itemStep(UID.b1, [GND])));

      assert.deepEqual((await Lib.optionListUsage(prisma, LIB.L)).map((u) => [u.route_id, u.field_id, u.ver, u.in]), [
        [R.kit, BOX.id, 2, "draft"], [R.kit, EACH.id, 2, "draft"], [R.kit, CABLE.id, 2, "draft"],
        [R.alpha, LED.id, 2, "draft"], [R.beta, EXT_B.id, 1, "published"], [R.gamma, EXT_G.id, 2, "draft"],
      ]);
      assert.deepEqual(await Lib.propagateOptionList(prisma, LIB.L, {}, ACTOR), { updated_drafts: 0 }, "nothing left to update");
      assert.deepEqual(await revs(), after);

      // What propagate wrote is a draft like any other: it publishes.
      await A.publishFields(prisma, { route_ids: [R.gamma], base_revs: { [R.gamma]: after[R.gamma] }, apply_mode: "new_only" }, ACTOR);
      assert.equal((await routeState(R.gamma)).fields_version, 2);
    });

    it("option list: propagate with targets updates exactly the named fields — a target naming a field that is not linked, the right field on another route, or a missing route changes nothing", async () => {
      await seedWorld();
      await Lib.updateOptionList(prisma, LIB.L, { name: "מצב נורית", options: LED_OPTIONS_V2, base_version: 1 }, ACTOR);
      const before = await revs();
      const result = await Lib.propagateOptionList(prisma, LIB.L, {
        targets: [
          { route_id: R.kit, step_uid: UID.kOpen, field_id: EACH.id },
          { route_id: R.kit, step_uid: UID.kOpen, field_id: "f_zzzzzzzz" },
          { route_id: R.alpha, step_uid: UID.kOpen, field_id: BOX.id },
          { route_id: 2147483647, step_uid: UID.a1, field_id: LED.id },
        ],
      }, ACTOR);
      assert.deepEqual(result, { updated_drafts: 1 });
      const after = await revs();
      assert.deepEqual(after, { ...before, [R.kit]: before[R.kit] + 1 });
      const [box, each, cable] = (await routeState(R.kit)).fields_draft!.steps[UID.kOpen].groups.map((g) => g.fields[0]);
      assert.deepEqual(each, { ...EACH, options: LED_OPTIONS_V2, list_ref: { id: LIB.L, ver: 2 } });
      assert.deepEqual([box, cable], [linkTo(BOX, LIB.L), linkTo(CABLE, LIB.L)], "the others keep version 1");
    });

    it("field set: propagate replaces each outdated cell's set fields in place with the set's current fields under fresh ids unique in the step (option ids kept, sections not copied), linked at the current version; drafts only; up-to-date cells are skipped; targets pick cells", async () => {
      await seedWorld();
      assert.deepEqual(await Lib.updateFieldSet(prisma, LIB.S, { name: "בדיקה חזותית בסיסית", fields: S_FIELDS_V2, base_version: 1 }, ACTOR), { version: 2 });
      const published = await publishedState();
      const before = await revs();
      const kitBefore = (await routeState(R.kit)).fields_draft!;
      const alphaBefore = (await routeState(R.alpha)).fields_draft!;

      assert.deepEqual(await Lib.propagateFieldSet(prisma, LIB.S, {}, ACTOR), { updated_drafts: 2 });
      assert.deepEqual(await publishedState(), published, "published versions and pointers unchanged");
      assert.deepEqual(await revs(), { ...before, [R.kit]: before[R.kit] + 1, [R.alpha]: before[R.alpha] + 1 });

      const kit = (await routeState(R.kit)).fields_draft;
      const alpha = (await routeState(R.alpha)).fields_draft;
      /** A cell's fields without their ids, and their ids. */
      const strip = (fields: Field[]) => fields.map(({ id: _id, ...rest }) => rest);
      const linked2 = (f: Field) => {
        const { id: _id, ...rest } = fromSet(f, LIB.S, 2);
        return rest;
      };
      const template = [S_NEW, S_EXT_V2, S_GND].map(linked2);
      assert.deepEqual(strip(cell(kit, UID.kClose, 0)), [strip([OWN1])[0], ...template, strip([OWN2])[0]], "in place, between the cell's own fields");
      assert.deepEqual(strip(cell(kit, UID.kClose, 1)), template);
      assert.deepEqual(strip(cell(alpha, UID.a2, 0)), template);
      assert.ok(![...cell(kit, UID.kClose, 0), ...cell(kit, UID.kClose, 1)].some((f) => f.type === "section"), "the set's section header is not copied");
      const ext = cell(kit, UID.kClose, 0)[2];
      assert.ok(ext.type === "choice_row");
      assert.deepEqual(ext.options, EXT_OPTIONS, "option ids kept");
      assert.deepEqual(cell(kit, UID.kClose, 0)[0], OWN1, "the cell's own fields keep their ids");
      assert.deepEqual(cell(kit, UID.kClose, 0)[4], OWN2);

      // Ids: fresh, well-formed, unique in the step across its groups, none of the replaced ones.
      const oldIds = new Set(stepFieldIds(kitBefore, UID.kClose));
      const ids = stepFieldIds(kit, UID.kClose);
      assert.equal(new Set(ids).size, ids.length, "unique in the step");
      const fresh = ids.filter((id) => id !== OWN1.id && id !== OWN2.id);
      assert.equal(fresh.length, 6);
      for (const id of fresh) {
        assert.match(id, ID_PATTERNS.field);
        assert.ok(!oldIds.has(id), `${id} is fresh`);
      }
      const alphaIds = stepFieldIds(alpha, UID.a2);
      assert.equal(new Set(alphaIds).size, 3);
      assert.ok(!alphaIds.includes(S_EXT.id) && !alphaIds.includes(S_GND.id), "the replaced ids are not reused");
      assert.deepEqual(kit?.steps[UID.kOpen], kitBefore.steps[UID.kOpen], "other steps untouched");
      assert.deepEqual(alpha?.steps[UID.a1], alphaBefore.steps[UID.a1]);
      // The drafts still read as configs (the parse an autosave would run).
      assert.equal((await A.getRouteFields(prisma, R.kit)).draft_rev, before[R.kit] + 1);

      assert.deepEqual((await Lib.listFieldSets(prisma))[0].usage, { cells: 3, outdated: 0 });
      assert.deepEqual(await Lib.propagateFieldSet(prisma, LIB.S, {}, ACTOR), { updated_drafts: 0 }, "every cell is current");

      // Version 3, and only the cell holding the target's field takes it.
      await Lib.updateFieldSet(prisma, LIB.S, { name: "בדיקה חזותית בסיסית", fields: [S_GND], base_version: 2 }, ACTOR);
      const eachFirst = cell(kit, UID.kClose, 1)[0].id;
      const revsBefore = await revs();
      assert.deepEqual(await Lib.propagateFieldSet(prisma, LIB.S, {
        targets: [{ route_id: R.kit, step_uid: UID.kClose, field_id: eachFirst }, { route_id: R.alpha, step_uid: UID.kClose, field_id: eachFirst }],
      }, ACTOR), { updated_drafts: 1 });
      assert.deepEqual(await revs(), { ...revsBefore, [R.kit]: revsBefore[R.kit] + 1 });
      const kit3 = (await routeState(R.kit)).fields_draft;
      assert.deepEqual(strip(cell(kit3, UID.kClose, 1)), [linked2({ ...S_GND })].map((f) => ({ ...f, from_set: { id: LIB.S, ver: 3 } })));
      assert.deepEqual(cell(kit3, UID.kClose, 0), cell(kit, UID.kClose, 0), "the box cell keeps version 2");
      assert.deepEqual((await Lib.listFieldSets(prisma))[0].usage, { cells: 3, outdated: 2 });
    });

    it("field set: a propagate that would overfill a cell is a 422 PROPAGATE_INVALID naming the route, and writes nothing — not even the routes before it", async () => {
      await seedWorld();
      // 58 fields: the kit's box cell (two of its own) reaches the 60 a group holds; ALPHA's cell,
      // given three fields of its own, would hold 61. The kit's route (lower id) is rewritten first.
      const many = Array.from({ length: 58 }, (_, i): Field => ({ id: `f_many${String(i).padStart(4, "0")}`, type: "text", label: `שדה ${i}`, required: false, notes: "off" }));
      await Lib.updateFieldSet(prisma, LIB.S, { name: "גדולה", fields: many, base_version: 1 }, ACTOR);
      const own3: Field = { ...OWN2, id: "f_own00003" };
      await saveDraft(R.alpha, config(
        itemStep(UID.a1, [linkTo(LED, LIB.L)]),
        itemStep(UID.a2, [fromSet(S_EXT, LIB.S), fromSet(S_GND, LIB.S), OWN1, OWN2, own3]),
      ));
      assert.ok(R.kit < R.alpha);
      const before = await revs();
      const drafts = await H.q("SELECT test_route_id, fields_draft FROM testing_routes ORDER BY test_route_id");
      const e = await rejectsAdmin(Lib.propagateFieldSet(prisma, LIB.S, {}, ACTOR), 422, "PROPAGATE_INVALID");
      assert.equal(e.extra.route_id, R.alpha);
      assert.equal(typeof e.extra.path, "string");
      assert.deepEqual(await revs(), before);
      assert.deepEqual(await H.q("SELECT test_route_id, fields_draft FROM testing_routes ORDER BY test_route_id"), drafts, "the kit's rewrite rolled back with it");
    });

    // -------------------------------------------------------------------------------------
    // Delete
    // -------------------------------------------------------------------------------------

    it("delete: 409 IN_USE while a draft or a published version uses the row — an option list also while a field set's field links to it; otherwise archived: gone from GET and 404 on every by-id call", async () => {
      await seedWorld();
      const used = await rejectsAdmin(Lib.deleteOptionList(prisma, LIB.L, ACTOR), 409, "IN_USE");
      assert.deepEqual(used.extra, { usage: { fields: 6, routes: 4 }, field_sets: [] });
      const usedSet = await rejectsAdmin(Lib.deleteFieldSet(prisma, LIB.S, ACTOR), 409, "IN_USE");
      assert.deepEqual(usedSet.extra, { usage: { cells: 3, outdated: 0 } });

      // A list linked only from a field set's field.
      const N = await Lib.createOptionList(prisma, { name: "נוכחות רכיב", options: EXT_OPTIONS }, ACTOR);
      const T = await Lib.createFieldSet(prisma, { name: "קבלת פריט", fields: [linkTo(S_EXT, N.id)] }, ACTOR);
      const viaSet = await rejectsAdmin(Lib.deleteOptionList(prisma, N.id, ACTOR), 409, "IN_USE");
      assert.deepEqual(viaSet.extra, { usage: { fields: 0, routes: 0 }, field_sets: [{ id: T.id, name: "קבלת פריט" }] });

      // An unused set archives; then its list is free too.
      assert.deepEqual(await Lib.deleteFieldSet(prisma, T.id, { username: "deleter", name: null }), { id: T.id, archived: true });
      assert.deepEqual(await H.one("SELECT archived, updated_by FROM field_sets WHERE id = $1", [T.id]), { archived: true, updated_by: "deleter" });
      assert.deepEqual(await Lib.deleteOptionList(prisma, N.id, ACTOR), { id: N.id, archived: true });
      assert.deepEqual((await Lib.listOptionLists(prisma)).map((l) => l.id), [LIB.L, LIB.M], "archived hidden");
      assert.deepEqual((await Lib.listFieldSets(prisma)).map((s) => s.id), [LIB.S]);
      for (const call of [
        () => Lib.deleteOptionList(prisma, N.id, ACTOR),
        () => Lib.updateOptionList(prisma, N.id, { name: "x", options: [], base_version: 1 }, ACTOR),
        () => Lib.optionListUsage(prisma, N.id),
        () => Lib.propagateOptionList(prisma, N.id, {}, ACTOR),
      ]) await rejectsAdmin(call(), 404, "OPTION_LIST_NOT_FOUND");
      for (const call of [
        () => Lib.deleteFieldSet(prisma, T.id, ACTOR),
        () => Lib.updateFieldSet(prisma, T.id, { name: "x", fields: [], base_version: 1 }, ACTOR),
        () => Lib.fieldSetUsage(prisma, T.id),
        () => Lib.propagateFieldSet(prisma, T.id, {}, ACTOR),
      ]) await rejectsAdmin(call(), 404, "FIELD_SET_NOT_FOUND");

      // In use through a published version only: still refused, until the draft that drops it is published.
      await A.discardFieldsDraft(prisma, R.kit, { base_rev: (await routeState(R.kit)).draft_rev }, ACTOR);
      const alphaRev = await saveDraft(R.alpha, config(itemStep(UID.a1, [linkTo(LED, LIB.L)])));
      const publishedOnly = await rejectsAdmin(Lib.deleteFieldSet(prisma, LIB.S, ACTOR), 409, "IN_USE");
      assert.deepEqual(publishedOnly.extra, { usage: { cells: 1, outdated: 0 } });
      assert.deepEqual((await Lib.fieldSetUsage(prisma, LIB.S)).map((u) => [u.route_id, u.in]), [[R.alpha, "published"]]);
      await A.publishFields(prisma, { route_ids: [R.alpha], base_revs: { [R.alpha]: alphaRev }, apply_mode: "new_only" }, ACTOR);
      assert.deepEqual(await Lib.deleteFieldSet(prisma, LIB.S, ACTOR), { id: LIB.S, archived: true });
      assert.deepEqual(await Lib.listFieldSets(prisma), []);
    });

    // -------------------------------------------------------------------------------------
    // HTTP and the wire contract
    // -------------------------------------------------------------------------------------

    it("http: every write needs a session (401) and FIELDS_EDIT_ROLES (403, naming them) while reads stay open; answers are the lib's through JSON (201 on create); refusals keep their status and code; the compiler holds the views to the wire types", async () => {
      assert.deepEqual([LIST_MATCHES_WIRE, SET_MATCHES_WIRE, USE_MATCHES_WIRE], [true, true, true]);
      await seedWorld();
      const L = String(LIB.L);
      const S = String(LIB.S);
      const writes: { name: string; call: () => Promise<{ status: number; body: any }> }[] = [
        { name: "POST list", call: () => httpCall(http.lists.POST, "POST", "/api/settings/option-lists", { body: { name: "חדשה", options: [] } }) },
        { name: "PUT list", call: () => httpCall(http.list.PUT, "PUT", `/api/settings/option-lists/${L}`, { body: { name: "x", options: [], base_version: 1 }, params: { id: L } }) },
        { name: "DELETE list", call: () => httpCall(http.list.DELETE, "DELETE", `/api/settings/option-lists/${L}`, { params: { id: L } }) },
        { name: "propagate list", call: () => httpCall(http.listPropagate.POST, "POST", `/api/settings/option-lists/${L}/propagate`, { body: {}, params: { id: L } }) },
        { name: "POST set", call: () => httpCall(http.sets.POST, "POST", "/api/settings/field-sets", { body: { name: "חדשה", fields: [] } }) },
        { name: "PUT set", call: () => httpCall(http.set.PUT, "PUT", `/api/settings/field-sets/${S}`, { body: { name: "x", fields: [], base_version: 1 }, params: { id: S } }) },
        { name: "DELETE set", call: () => httpCall(http.set.DELETE, "DELETE", `/api/settings/field-sets/${S}`, { params: { id: S } }) },
        { name: "propagate set", call: () => httpCall(http.setPropagate.POST, "POST", `/api/settings/field-sets/${S}/propagate`, { body: {}, params: { id: S } }) },
      ];
      const libraries = () => H.q("SELECT * FROM option_lists UNION ALL SELECT id, name, fields, version, archived, created_at, updated_at, updated_by FROM field_sets ORDER BY 1, 2");
      const before = { libraries: await libraries(), revs: await revs() };
      session = null;
      for (const w of writes) assert.deepEqual(await w.call(), { status: 401, body: { error: "Unauthorized" } }, w.name);
      session = signedIn("storekeeper", "mashan");
      for (const w of writes) assert.deepEqual(await w.call(), { status: 403, body: { error: "Forbidden", required: FIELDS_EDIT_ROLES } }, w.name);
      assert.deepEqual({ libraries: await libraries(), revs: await revs() }, before, "nothing written");

      // Reads are not wrapped: the middleware signs them in, whatever the roles (spec §3.0).
      session = null;
      assert.deepEqual(await httpCall(http.lists.GET, "GET", "/api/settings/option-lists"), { status: 200, body: json(await Lib.listOptionLists(prisma)) });
      assert.deepEqual(await httpCall(http.sets.GET, "GET", "/api/settings/field-sets"), { status: 200, body: json(await Lib.listFieldSets(prisma)) });
      assert.deepEqual(await httpCall(http.listUsage.GET, "GET", `/api/settings/option-lists/${L}/usage`, { params: { id: L } }),
        { status: 200, body: json(await Lib.optionListUsage(prisma, LIB.L)) });
      assert.deepEqual(await httpCall(http.setUsage.GET, "GET", `/api/settings/field-sets/${S}/usage`, { params: { id: S } }),
        { status: 200, body: json(await Lib.fieldSetUsage(prisma, LIB.S)) });
      const listed = (await httpCall(http.lists.GET, "GET", "/api/settings/option-lists")).body as OptionListJson[];
      assert.equal(typeof listed[0].updated_at, "string");

      // A tester may write; the session's preferredUsername is the author.
      session = signedIn("tester");
      const created = await httpCall(http.lists.POST, "POST", "/api/settings/option-lists", { body: { name: "תוצאת הפעלה", options: LED_OPTIONS } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.deepEqual(created.body, json((await Lib.listOptionLists(prisma)).find((l) => l.id === created.body.id)));
      assert.equal(created.body.updated_by, "library-http");
      const createdSet = await httpCall(http.sets.POST, "POST", "/api/settings/field-sets", { body: { name: "התאמת מסך", fields: [S_NEW] } });
      assert.equal(createdSet.status, 201, JSON.stringify(createdSet.body));
      assert.deepEqual(createdSet.body, json((await Lib.listFieldSets(prisma)).find((s) => s.id === createdSet.body.id)));

      const put = await httpCall(http.list.PUT, "PUT", `/api/settings/option-lists/${L}`, { body: { name: "מצב נורית", options: LED_OPTIONS_V2, base_version: 1 }, params: { id: L } });
      assert.equal(put.status, 200, JSON.stringify(put.body));
      assert.deepEqual([put.body.version, put.body.linked.length], [2, 6]);
      const stale = await httpCall(http.list.PUT, "PUT", `/api/settings/option-lists/${L}`, { body: { name: "x", options: [], base_version: 1 }, params: { id: L } });
      assert.equal(stale.status, 409);
      assert.deepEqual(stale.body, {
        error: `Option list ${L} is at version 2, not 1`,
        code: "VERSION_CONFLICT",
        current: json((await Lib.listOptionLists(prisma)).find((l) => l.id === LIB.L)),
      });
      assert.deepEqual(
        await httpCall(http.listPropagate.POST, "POST", `/api/settings/option-lists/${L}/propagate`, { body: { targets: [{ route_id: R.alpha, step_uid: UID.a1, field_id: LED.id }] }, params: { id: L } }),
        { status: 200, body: { updated_drafts: 1 } },
      );
      assert.equal((await routeState(R.alpha)).draft_updated_by, "library-http");
      assert.deepEqual(
        await httpCall(http.set.PUT, "PUT", `/api/settings/field-sets/${S}`, { body: { name: "ב", fields: S_FIELDS_V2, base_version: 1 }, params: { id: S } }),
        { status: 200, body: { version: 2 } },
      );
      assert.deepEqual(
        await httpCall(http.setPropagate.POST, "POST", `/api/settings/field-sets/${S}/propagate`, { body: {}, params: { id: S } }),
        { status: 200, body: { updated_drafts: 2 } },
      );

      const inUse = await httpCall(http.list.DELETE, "DELETE", `/api/settings/option-lists/${L}`, { params: { id: L } });
      assert.deepEqual([inUse.status, inUse.body.code, inUse.body.usage], [409, "IN_USE", { fields: 6, routes: 4 }]);
      const freeId = String(created.body.id);
      assert.deepEqual(await httpCall(http.list.DELETE, "DELETE", `/api/settings/option-lists/${freeId}`, { params: { id: freeId } }),
        { status: 200, body: { id: created.body.id, archived: true } });
      const shape = await httpCall(http.sets.POST, "POST", "/api/settings/field-sets", { body: { name: "x", fields: [{ id: "bad" }] } });
      assert.deepEqual([shape.status, shape.body.code, shape.body.path], [400, "SHAPE_INVALID", "$.fields[0]"]);
      const notJson = await httpCall(http.lists.POST, "POST", "/api/settings/option-lists", { raw: "{not json" });
      assert.deepEqual([notJson.status, notJson.body.code], [400, "INVALID_BODY"]);
      const noBody = await httpCall(http.listPropagate.POST, "POST", `/api/settings/option-lists/${L}/propagate`, { params: { id: L } });
      assert.deepEqual([noBody.status, noBody.body.code], [400, "INVALID_BODY"], "propagate takes a JSON object ({} for every place)");
      const name = await httpCall(http.lists.POST, "POST", "/api/settings/option-lists", { body: { name: " ", options: [] } });
      assert.deepEqual([name.status, name.body.code], [400, "NAME_INVALID"]);
      for (const bad of ["abc", "0", "3000000000"]) {
        const r = await httpCall(http.listUsage.GET, "GET", `/api/settings/option-lists/${bad}/usage`, { params: { id: bad } });
        assert.deepEqual([r.status, r.body.code], [400, "INVALID_ID"], bad);
      }
      assert.deepEqual(await httpCall(http.setUsage.GET, "GET", "/api/settings/field-sets/2147483647/usage", { params: { id: "2147483647" } }), {
        status: 404, body: { error: "Field set 2147483647 not found", code: "FIELD_SET_NOT_FOUND", id: 2147483647 },
      });
    });

    it("errors: a route config or a library row that does not parse fails the read with a real 500 — never [] and never a zero count", async (t) => {
      // A 5xx is logged by the handler; keep it out of the test output, but make sure it happens.
      const logged = t.mock.method(console, "error", () => {});
      await seedWorld();
      await H.q(`UPDATE testing_routes SET fields_draft = '{"schema": 9}'::jsonb WHERE test_route_id = $1`, [R.gamma]);
      const e = await rejectsAdmin(Lib.listOptionLists(prisma), 500, "CONFIG_INVALID");
      assert.deepEqual(e.extra, { route_id: R.gamma });
      await rejectsAdmin(Lib.listFieldSets(prisma), 500, "CONFIG_INVALID");
      // GAMMA's published version links L, so L's usage reads that route — and fails on its draft.
      await rejectsAdmin(Lib.optionListUsage(prisma, LIB.L), 500, "CONFIG_INVALID");
      await rejectsAdmin(Lib.deleteOptionList(prisma, LIB.L, ACTOR), 500, "CONFIG_INVALID");
      for (const handler of [http.lists.GET, http.sets.GET]) {
        const r = await httpCall(handler, "GET", "/api/settings/option-lists");
        assert.equal(r.status, 500);
        assert.ok(!Array.isArray(r.body));
        assert.deepEqual([r.body.code, r.body.route_id], ["CONFIG_INVALID", R.gamma]);
      }

      await H.q("UPDATE testing_routes SET fields_draft = NULL WHERE test_route_id = $1", [R.gamma]);
      await H.q(`UPDATE option_lists SET options = '"x"'::jsonb WHERE id = $1`, [LIB.M]);
      const bad = await httpCall(http.lists.GET, "GET", "/api/settings/option-lists");
      assert.deepEqual([bad.status, bad.body.code, bad.body.id], [500, "LIST_INVALID", LIB.M]);
      await H.q(`UPDATE field_sets SET fields = '{}'::jsonb WHERE id = $1`, [LIB.S]);
      const badSet = await httpCall(http.sets.GET, "GET", "/api/settings/field-sets");
      assert.deepEqual([badSet.status, badSet.body.code, badSet.body.id], [500, "SET_INVALID", LIB.S]);
      assert.equal(logged.mock.callCount(), 4, "each 500 is logged");
    });
  },
);
