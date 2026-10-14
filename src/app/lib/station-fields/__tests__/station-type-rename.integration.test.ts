// Regression suite for the station-type id cascade (route-fields spec §3.6,
// open decision 5): changing a station type's id in Settings must rewrite every
// occurrence of the old id inside testing_routes.route_steps, in the same
// transaction that moves test_stations and testing_routes.test_station_type_id.
// Before the fix route_steps kept the deleted id, so every route through that
// type pointed nowhere and its items silently dropped out of the station queue.
// The rename here also keeps the description, as the settings form does when
// only the id is edited — a path the UNIQUE test_type_desc used to fail with 500.
//
// The same transaction rewrites the station-field drafts that name the old id
// (renameStationTypeInDrafts); published versions are history and keep it, and
// fields still resolve by step uid (spec §8.1).
//
// Like write-path.integration.test.ts, this drives the REAL handlers: the rename
// is PUT /api/settings/test-stations-type/[id], the queue is GET
// /api/testing/items and a popup's fields are GET /api/testing/station-fields.
// None is wrapped in withAuth (authentication lives in the middleware,
// src/lib/routes.ts), so all are invoked directly. The draft and the version are
// written through admin.ts, the functions behind the withAuth'd field endpoints.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database; without it the
// describe block is skipped. It borrows the write-path harness, whose setup()
// holds the ledger suites' advisory lock for the life of this file: resetDb()
// truncates the same tables they do, and `node --test` runs files in parallel.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as H from "../../metrics/__tests__/write-path-helpers";
import type { RouteFieldsConfig, StepConfig } from "../schema";

/** A plain item type whose route visits TYPE_FUNC twice: {FUNC, INTAKE, FUNC}. */
const ITEM_TYPE_TWICE = 8;
/** The id TYPE_FUNC is renamed to — free in the fixture. */
const TYPE_FUNC_RENAMED = 21;

/** Items queued on ITEM_TYPE_TWICE's route, one per step. */
const ITEM_AT_FIRST_FUNC = 8001; // step 1
const ITEM_AT_INTAKE = 8002; // step 2 — the control: never in a FUNC queue
const ITEM_AT_SECOND_FUNC = 8003; // step 3

/** The queue handler INNER JOINs item_status. Migrations seed only status 6;
 *  1–5 arrive with each environment's settings data, so a clone built from the
 *  migrations alone has no "queued" row. The suite adds one under this marker
 *  description and removes exactly that row again — all inside the lock. */
const QUEUED_STATUS_MARKER = "QUEUED (station-type rename suite)";

type RenameHandler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type QueueHandler = (req: Request) => Promise<Response>;

type RouteSnapshot = { routeId: number; itemTypeId: number; typeId: number; steps: number[] };

describe(
  "station-type id rename cascades into testing_routes.route_steps",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — station-type rename integration suite skipped" },
  () => {
    let rename: RenameHandler;
    let queue: QueueHandler;
    let stationFields: QueueHandler;
    let A: typeof import("../admin");
    let prisma: (typeof import("../../prisma"))["prisma"];

    before(async () => {
      // MUST come first: it points DATABASE_URL at the scratch database before
      // anything imports the Prisma client, and takes the advisory lock.
      await H.setup();
      rename = (await import("../../../api/settings/test-stations-type/[id]/route")).PUT;
      queue = (await import("../../../api/testing/items/route")).GET;
      stationFields = (await import("../../../api/testing/station-fields/route")).GET;
      A = await import("../admin");
      prisma = (await import("../../prisma")).prisma;
      await H.q(
        `INSERT INTO item_status (item_status_id, item_status_desc) VALUES ($1, $2)
         ON CONFLICT (item_status_id) DO NOTHING`,
        [H.STATUS.queued, QUEUED_STATUS_MARKER],
      );
    });
    after(async () => {
      try {
        await H.q("DELETE FROM item_status WHERE item_status_id = $1 AND TRIM(item_status_desc) = $2", [
          H.STATUS.queued,
          QUEUED_STATUS_MARKER,
        ]);
      } finally {
        await H.teardown();
      }
    });
    beforeEach(async () => {
      await H.resetDb();
      await H.q("INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'TWICE', false)", [
        ITEM_TYPE_TWICE,
      ]);
      // FUNC first, so the route's test_station_type_id (the POST handler's
      // first step) is FUNC as well. The middle step only has to be another type.
      await H.q(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number)
         VALUES ($1, $2, ARRAY[$2::int, $3::int, $2::int], 1)`,
        [ITEM_TYPE_TWICE, H.TYPE_FUNC, H.TYPE_INTAKE],
      );
    });

    /** Operational rows only (items + item_routes, queued at `step`): neither
     *  handler under test reads the ledger. */
    async function seedQueuedAt(itemId: number, step: number, stationId: number): Promise<void> {
      await H.seedLegacyItem({ itemId, itemTypeId: ITEM_TYPE_TWICE, stationId });
      await H.q("UPDATE item_routes SET current_route_step = $2 WHERE item_id = $1", [itemId, step]);
    }

    async function routes(): Promise<RouteSnapshot[]> {
      const rows = await H.q<{ test_route_id: number; item_type_id: number; test_station_type_id: number; route_steps: number[] }>(
        "SELECT test_route_id, item_type_id, test_station_type_id, route_steps FROM testing_routes ORDER BY test_route_id",
      );
      return rows.map((r) => ({
        routeId: r.test_route_id,
        itemTypeId: r.item_type_id,
        typeId: r.test_station_type_id,
        steps: [...r.route_steps],
      }));
    }

    /** The item ids GET /api/testing/items lists for a station, ascending. */
    async function queuedAt(stationId: number): Promise<number[]> {
      const res = await queue(new Request(`http://localhost/api/testing/items?stationId=${stationId}`));
      assert.equal(res.status, 200);
      const rows = (await res.json()) as { item_id: number }[];
      return rows.map((r) => Number(r.item_id)).sort((a, b) => a - b);
    }

    async function renameType(oldId: number, newId: number, desc: string): Promise<{ status: number; body: any }> {
      // The body the settings form sends: the edited id arrives as the text
      // input's string value.
      const req = new Request(`http://localhost/api/settings/test-stations-type/${oldId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test_station_type_id: String(newId),
          test_type_desc: desc,
          package_level: false,
          stale_after_minutes: 30,
        }),
      });
      const res = await rename(req, { params: Promise.resolve({ id: String(oldId) }) });
      return { status: res.status, body: await res.json() };
    }

    it("rewrites both occurrences in route_steps, moves test_station_type_id, and the queue still finds the items", async () => {
      await seedQueuedAt(ITEM_AT_FIRST_FUNC, 1, H.STATION_FUNC_A);
      await seedQueuedAt(ITEM_AT_INTAKE, 2, H.STATION_INTAKE);
      await seedQueuedAt(ITEM_AT_SECOND_FUNC, 3, H.STATION_FUNC_A);

      // Fixture sanity: the queue matches by route step, so both FUNC steps are
      // listed and the INTAKE step is not. Without this the "after" check could
      // pass on a queue that lists nothing (its catch answers [] with a 200).
      assert.deepEqual(await queuedAt(H.STATION_FUNC_A), [ITEM_AT_FIRST_FUNC, ITEM_AT_SECOND_FUNC]);

      const routesBefore = await routes();
      const res = await renameType(H.TYPE_FUNC, TYPE_FUNC_RENAMED, "FUNC");
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.test_station_type_id, TYPE_FUNC_RENAMED);

      // The route that visits FUNC twice now carries the new id in BOTH places.
      const routesAfter = await routes();
      const twice = routesAfter.find((r) => r.itemTypeId === ITEM_TYPE_TWICE);
      assert.ok(twice, "the TWICE route must still exist");
      assert.deepEqual(twice.steps, [TYPE_FUNC_RENAMED, H.TYPE_INTAKE, TYPE_FUNC_RENAMED]);
      assert.equal(twice.typeId, TYPE_FUNC_RENAMED);

      // Every route is exactly its old self with FUNC replaced — the other
      // routes through FUNC are rewritten too, the rest are untouched.
      const swap = (id: number) => (id === H.TYPE_FUNC ? TYPE_FUNC_RENAMED : id);
      assert.deepEqual(
        routesAfter,
        routesBefore.map((r) => ({ ...r, typeId: swap(r.typeId), steps: r.steps.map(swap) })),
      );
      const stale = await H.q("SELECT test_route_id FROM testing_routes WHERE $1::int = ANY(route_steps)", [H.TYPE_FUNC]);
      assert.deepEqual(stale, [], "no route may still reference the deleted id");

      // The pre-existing half of the cascade still holds, and the type keeps its
      // real description (the placeholder that frees it never commits).
      const stations = await H.q<{ test_station_type_id: number }>(
        "SELECT test_station_type_id FROM test_stations WHERE test_station_id = ANY($1::int[]) ORDER BY test_station_id",
        [[H.STATION_FUNC_A, H.STATION_FUNC_B]],
      );
      assert.deepEqual(stations.map((s) => s.test_station_type_id), [TYPE_FUNC_RENAMED, TYPE_FUNC_RENAMED]);
      assert.deepEqual(await H.q("SELECT 1 FROM test_stations_type WHERE test_station_type_id = $1", [H.TYPE_FUNC]), []);
      const renamed = await H.one<{ type_desc: string }>(
        "SELECT TRIM(test_type_desc) AS type_desc FROM test_stations_type WHERE test_station_type_id = $1",
        [TYPE_FUNC_RENAMED],
      );
      assert.equal(renamed.type_desc, "FUNC");

      // The point of the fix: the station of the renamed type still lists the
      // items waiting at either of its steps.
      assert.deepEqual(await queuedAt(H.STATION_FUNC_A), [ITEM_AT_FIRST_FUNC, ITEM_AT_SECOND_FUNC]);
    });

    it("rewrites the station-field draft to the new id without a new draft_rev, leaves the published version as it was, and an item frozen at that version still gets its fields by step uid", async () => {
      const UIDS = ["s_twice001", "s_twice002", "s_twice003"];
      const route = await H.one<{ test_route_id: number }>(
        "UPDATE testing_routes SET step_uids = $2::text[] WHERE item_type_id = $1 AND route_number = 1 RETURNING test_route_id",
        [ITEM_TYPE_TWICE, UIDS],
      );
      const routeId = route.test_route_id;
      const actor = { username: "rename-suite", name: "Rename Suite" };
      const funcStep = (uid: string, fieldId: string): StepConfig => ({
        uid, station_type_id: H.TYPE_FUNC, station_label: "FUNC", scope: "item",
        groups: [{ target: "item", fields: [{ id: fieldId, type: "pass_fail", label: `check ${fieldId}`, required: true, notes: "optional" }] }],
      });
      const cfg = (...steps: StepConfig[]): RouteFieldsConfig => ({ schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) });

      // Version 1: fields at the second FUNC step. Then a draft over both FUNC steps.
      const v1 = cfg(funcStep(UIDS[2], "f_second01"));
      const rev1 = (await A.saveFieldsDraft(prisma, routeId, { config: v1, base_rev: 0 }, actor)).draft_rev;
      await A.publishFields(prisma, { route_ids: [routeId], base_revs: { [routeId]: rev1 }, apply_mode: "new_only" }, actor);
      const draft = cfg(funcStep(UIDS[0], "f_first001"), funcStep(UIDS[2], "f_second01"));
      const rev = (await A.saveFieldsDraft(prisma, routeId, { config: draft, base_rev: rev1 + 1 }, actor)).draft_rev;
      await seedQueuedAt(ITEM_AT_SECOND_FUNC, 3, H.STATION_FUNC_A);
      await H.q("UPDATE item_routes SET fields_version = 1 WHERE item_id = $1", [ITEM_AT_SECOND_FUNC]);
      const fieldsBefore = await stationFieldsOf(ITEM_AT_SECOND_FUNC);
      assert.equal(fieldsBefore.mode, "item", "the control: the frozen version configures step 3");
      const before = await H.one<{ draft_updated_at: Date; draft_updated_by: string }>(
        "SELECT draft_updated_at, draft_updated_by FROM testing_routes WHERE test_route_id = $1",
        [routeId],
      );

      const res = await renameType(H.TYPE_FUNC, TYPE_FUNC_RENAMED, "FUNC");
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const after = await H.one<{ fields_draft: unknown; draft_rev: number; draft_updated_at: Date; draft_updated_by: string; step_uids: string[]; fields_version: number }>(
        "SELECT fields_draft, draft_rev, draft_updated_at, draft_updated_by, step_uids, fields_version FROM testing_routes WHERE test_route_id = $1",
        [routeId],
      );
      const renamed = (s: StepConfig): StepConfig => ({ ...s, station_type_id: TYPE_FUNC_RENAMED });
      assert.deepEqual(after.fields_draft, cfg(renamed(draft.steps[UIDS[0]]), renamed(draft.steps[UIDS[2]])));
      assert.equal(after.draft_rev, rev, "nothing the admin edited changed: the open editor's base_rev stays good");
      assert.deepEqual([after.draft_updated_at, after.draft_updated_by], [before.draft_updated_at, before.draft_updated_by]);
      assert.deepEqual(after.step_uids, UIDS, "no step moved");
      assert.equal(after.fields_version, 1);
      const versions = await H.q<{ version: number; config: unknown }>(
        "SELECT version, config FROM route_field_versions WHERE test_route_id = $1",
        [routeId],
      );
      assert.deepEqual(versions, [{ version: 1, config: v1 }], "a published version is history: it keeps the old id");

      // Resolution goes uid → step_uids → route_steps (now the new id): the fields are still there.
      assert.deepEqual(await stationFieldsOf(ITEM_AT_SECOND_FUNC), fieldsBefore);
    });

    /** GET /api/testing/station-fields for an item, opened on FUNC-A. */
    async function stationFieldsOf(itemId: number): Promise<any> {
      const res = await stationFields(new Request(`http://localhost/api/testing/station-fields?itemId=${itemId}&stationId=${H.STATION_FUNC_A}`));
      assert.equal(res.status, 200);
      return res.json();
    }
  },
);
