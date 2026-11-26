// POST /api/testing/step-back — "חזרה לבדיקה הקודמת": a waiting item goes one step back on its
// route, waits there again, and the ledger counts it as that step's next attempt. Refused for an
// item in test, a first step, a step back onto the box's own (package-level) step, a whole box,
// and a stale card; two clicks never take an item back twice. An item that had reached the
// closing station takes the box back to waiting for its items. Only who holds ACCESS.stepBack
// (managers and testers by default, unless it was taken away from them — no-step-back): anyone
// else (or no session) is refused before anything moves.
//
// Runs ONLY when TEST_DATABASE_URL points at a throwaway database (the write-path harness).
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { ACCESS } from "@/lib/auth/roles";
import * as H from "@/test-support/db-harness";
import { stubSession } from "@/lib/auth/testing";

/** FUNC → FUNC: two regular steps (the fixture's other routes start at the package-level INTAKE). */
const ITEM_TYPE_FUNC_TWICE = 8;

// The session withAuth sees.
let session: unknown = null;
const signedIn = (...roles: string[]) => ({
  user: { preferredUsername: "step-back", displayName: "בודק", name: "step-back", employeeNumber: "9001" },
  roles,
});

describe(
  "step back — one step back to the station before, or a refusal in words",
  { skip: H.TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set — step-back integration suite skipped" },
  () => {
    let POST: (req: Request) => Promise<Response>;

    before(async () => {
      stubSession(() => session);
      await H.setup();
      POST = (await import("../step-back/route")).POST as unknown as typeof POST;
    });
    after(async () => {
      await H.teardown();
    });
    beforeEach(async () => {
      session = signedIn("manager");
      await H.resetDb();
      await H.q(`INSERT INTO item_types (item_type_id, item_type_desc, is_package) VALUES ($1, 'FUNC_TWICE', false)`, [ITEM_TYPE_FUNC_TWICE]);
      await H.q(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES ($1, $2, ARRAY[$2::int, $2::int], 1)`,
        [ITEM_TYPE_FUNC_TWICE, H.TYPE_FUNC],
      );
    });

    const stepBack = async (itemId: number, currentRouteStep: number, actionId = randomUUID()) => {
      const res = await POST(H.jsonRequest("/api/testing/step-back", {
        itemId: String(itemId), currentRouteStep, workerId: H.WORKER_ID, workerName: H.WORKER_NAME, actionId,
      }));
      return { status: res.status, body: await res.json() };
    };
    /** Start and pass the item at its current station. */
    const pass = async (itemId: number, stationId: number) => {
      assert.equal((await H.startTest({ itemId, stationId, actionUuid: randomUUID() })).status, 200);
      const r = await H.submitResult({ ItemID: itemId, StationID: stationId, SubmitID: randomUUID(), Passed: true });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    };
    const assertNoDrift = async () => assert.deepEqual(await H.openDriftRows(), []);

    it("a waiting item at step 2 goes back to step 1, waits there, and the ledger says why", async () => {
      await H.seedItem({ itemId: 8101, itemTypeId: ITEM_TYPE_FUNC_TWICE, stationId: H.STATION_FUNC_A });
      await pass(8101, H.STATION_FUNC_A);
      assert.equal((await H.routeRow(8101)).current_route_step, 2);

      const r = await stepBack(8101, 2);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.routeStep, 1);
      assert.equal(r.body.stationTypeId, H.TYPE_FUNC);
      assert.ok(r.body.stationDesc, "the dialog names the station it went back to");

      const route = await H.routeRow(8101);
      assert.equal(route.current_route_step, 1);
      assert.equal(route.current_status, H.STATUS.queued);
      assert.ok([H.STATION_FUNC_A, H.STATION_FUNC_B].includes(route.test_station_id!));

      const last = (await H.events(8101)).filter((e) => e.kind === "transition").at(-1)!;
      assert.equal(last.reason, "manual_override");
      assert.equal(last.to_state, "queued");
      assert.equal(last.step_no, 1);
      assert.equal(last.payload.action, "step_back");
      assert.equal(last.payload.from_step, 2);
      const open = await H.openInterval(8101);
      assert.equal(open?.state_key, "queued");
      assert.equal(open?.step_no, 1);
      assert.equal(open?.attempt_no, 2, "the second wait at step 1");
      assert.equal(open?.station_type_id, H.TYPE_FUNC);
      await assertNoDrift();

      // The earlier result stays; testing again adds the step's second one and moves on as usual.
      await pass(8101, route.test_station_id!);
      assert.deepEqual((await H.testResults(8101)).map((t) => t.route_step), [1, 1]);
      assert.equal((await H.routeRow(8101)).current_route_step, 2);
      await assertNoDrift();
    });

    it("who holds step-back: a tester it was taken from (no-step-back), a storekeeper and no session are refused and the item stays; a tester may", async () => {
      await H.seedItem({ itemId: 8104, itemTypeId: ITEM_TYPE_FUNC_TWICE, stationId: H.STATION_FUNC_A });
      await pass(8104, H.STATION_FUNC_A);
      const before = (await H.events(8104)).length;

      const refused = [
        [signedIn("tester", ACCESS.stepBack.deny), 403],
        // A migrated realm: the bundle without step-back.
        [signedIn("tester", "perm-testing"), 403],
        [signedIn("storekeeper", "mashan"), 403],
        [null, 401],
      ] as const;
      for (const [who, status] of refused) {
        session = who;
        const r = await stepBack(8104, 2);
        assert.equal(r.status, status, JSON.stringify(r.body));
        if (status === 403) assert.equal(r.body.required, ACCESS.stepBack.role);
      }
      const route = await H.routeRow(8104);
      assert.deepEqual([route.current_route_step, route.current_status], [2, H.STATUS.queued]);
      assert.equal((await H.events(8104)).length, before, "nothing written to the ledger");

      session = signedIn("tester", "perm-testing", ACCESS.stepBack.role);
      assert.equal((await stepBack(8104, 2)).status, 200);
      assert.equal((await H.routeRow(8104)).current_route_step, 1);
      await assertNoDrift();
    });

    it("two clicks on the same card: one goes back, the other is told the item moved", async () => {
      await H.seedItem({ itemId: 8102, itemTypeId: ITEM_TYPE_FUNC_TWICE, stationId: H.STATION_FUNC_A });
      await pass(8102, H.STATION_FUNC_A);
      const [a, b] = await Promise.all([stepBack(8102, 2), stepBack(8102, 2)]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409]);
      assert.match((a.status === 409 ? a : b).body.error, /זז בינתיים/);
      assert.equal((await H.routeRow(8102)).current_route_step, 1);
      await assertNoDrift();
    });

    it("refused with words, nothing written: in test, first step, a stale card", async () => {
      await H.seedItem({ itemId: 8103, itemTypeId: ITEM_TYPE_FUNC_TWICE, stationId: H.STATION_FUNC_A });
      let r = await stepBack(8103, 1);
      assert.equal(r.status, 409);
      assert.match(r.body.error, /העמדה הראשונה/);

      await pass(8103, H.STATION_FUNC_A);
      r = await stepBack(8103, 1);
      assert.equal(r.status, 409, "the card showed step 1, the item is at step 2");
      assert.match(r.body.error, /זז בינתיים/);

      assert.equal((await H.startTest({ itemId: 8103, stationId: H.STATION_FUNC_A, actionUuid: randomUUID() })).status, 200);
      r = await stepBack(8103, 2);
      assert.equal(r.status, 409);
      assert.match(r.body.error, /בבדיקה/);
      const route = await H.routeRow(8103);
      assert.deepEqual([route.current_route_step, route.current_status], [2, H.STATUS.testing]);

      r = await stepBack(8103, 0);
      assert.equal(r.status, 400);
      await assertNoDrift();
    });

    it("a box item: never back onto the opening; from the closing station the box waits for it again", async () => {
      const box = await H.h().prisma.$transaction((tx) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID, shipment: H.SHIPMENT_ID, packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
          items: [{ itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-BOX-1", makat: "MK-1", model: "MODEL", manufacturer: "MFR" }],
        }),
      );
      const [item] = box.itemIds as number[];
      // Open the box: the item goes to FUNC (step 2), the box to CLOSE, waiting for it.
      await H.startTest({ itemId: box.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
      const submitId = randomUUID();
      assert.equal((await H.submitResult({ ItemID: item, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true })).status, 200);
      assert.equal((await H.submitResult({ ItemID: box.packageId, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true })).status, 200);

      let r = await stepBack(item, 2);
      assert.equal(r.status, 409);
      assert.match(r.body.error, /שלב של המארז כולו/);

      r = await stepBack(box.packageId, 2);
      assert.equal(r.status, 409);
      assert.match(r.body.error, /מארז שלם/);

      // Through FUNC: the item reaches CLOSE and the box queues for closing.
      await pass(item, H.STATION_FUNC_A);
      assert.equal((await H.routeRow(box.packageId)).current_status, H.STATUS.queued);

      r = await stepBack(item, 3);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal((await H.routeRow(item)).current_route_step, 2);
      assert.equal((await H.routeRow(box.packageId)).current_status, 6, "the box waits for its item again");
      await assertNoDrift();
    });

    it("from inside the closing wizard: the closing stops, the item goes back, the box waits for it", async () => {
      const box = await H.h().prisma.$transaction((tx) =>
        H.h().createPackage(tx, {
          customer: H.CUSTOMER_ID, shipment: H.SHIPMENT_ID, packageType: H.ITEM_TYPE_PACKAGE_CLOSE,
          items: [
            { itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-BOX-A", makat: "MK-1", model: "MODEL", manufacturer: "MFR" },
            { itemType: H.ITEM_TYPE_IN_BOX, serialNumber: "SN-BOX-B", makat: "MK-1", model: "MODEL", manufacturer: "MFR" },
          ],
        }),
      );
      const [itemA, itemB] = box.itemIds as number[];
      await H.startTest({ itemId: box.packageId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
      const submitId = randomUUID();
      for (const id of [itemA, itemB, box.packageId]) {
        assert.equal((await H.submitResult({ ItemID: id, StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true })).status, 200);
      }
      await pass(itemA, H.STATION_FUNC_A);
      await pass(itemB, H.STATION_FUNC_A);
      assert.equal((await H.routeRow(box.packageId)).current_status, H.STATUS.queued);

      // The closing wizard opens: the box and both items are in test together.
      assert.equal((await H.startTest({ itemId: box.packageId, stationId: H.STATION_CLOSE, actionUuid: randomUUID() })).status, 200);
      assert.equal((await H.routeRow(itemA)).current_status, H.STATUS.testing);

      // In test, but inside its box's open closing: taken.
      const r = await stepBack(itemA, 3);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.closingStopped, true);
      const a = await H.routeRow(itemA);
      assert.equal(a.current_route_step, 2);
      assert.equal(a.current_status, H.STATUS.queued);
      assert.equal((await H.routeRow(itemB)).current_status, H.STATUS.queued, "the other item waits at the closing again");
      assert.equal((await H.routeRow(box.packageId)).current_status, 6, "the box waits for the item that went back");
      await assertNoDrift();
    });
  },
);
