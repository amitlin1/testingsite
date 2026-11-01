// Two read-path rules found by the stepwise dashboard check (seeding through the
// real HTTP endpoints, then comparing every dashboard number to an independent
// model built from item_routes):
//
//  1. A `queued` row that one submission opened and closed is not a wait. The
//     event contract writes one at the end of every route (#9 queued for step
//     N+1, #10 done, same transaction) and one for every opened box (#9 queued
//     at the closing step, the readiness recheck flips it to status 6). The
//     rows stay in the ledger — the write-path suite pins those sequences — but
//     Q4 and Q5 must not count them as waits.
//  2. At a package-level station the live board counts the BOX, not the box
//     plus its hidden items: the station's own screen lists one row per box.
//
// Runs ONLY with TEST_DATABASE_URL (a throwaway database carrying every
// migration); borrows the write-path harness and its fixture.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as H from "./write-path-helpers";

type Queries = typeof import("../queries");
let Q: Queries;
let boxes: typeof import("../../packages/boxes");
let today = "";

const BOX_TYPE = H.ITEM_TYPE_PACKAGE_CLOSE; // route [INTAKE, CLOSE]
const ALL = { scope: "all" as const };
const window = () => [new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000)] as const;

const waitFlow = () =>
  Q.flow(H.h().prisma, today, today, ALL, { dimension: "none", family: "waiting", byDay: false });
const kpi = () => {
  const [from, to] = window();
  return Q.kpiWindowOne(H.h().prisma, from, to, ALL);
};
const board = async (stationId: number) =>
  (await Q.stationBoard(H.h().prisma)).find((r) => r.test_station_id === stationId)!;

describe("pass-through queue rows and the package-level board", { skip: H.skipReason() }, () => {
  before(async () => {
    await H.setup();
    Q = await import("../queries");
    boxes = await import("../../packages/boxes");
    const { toBusinessDay } = await import("../period");
    today = toBusinessDay(new Date())!;
  });
  after(async () => {
    await H.teardown();
  });
  beforeEach(async () => {
    await H.resetDb();
  });

  it("the end of a route: the #9/#10 queued row stays in the ledger and out of every wait statistic", async () => {
    const itemId = 990000000000101;
    await H.seedItem({ itemId, itemTypeId: H.ITEM_TYPE_ONE_STEP });
    assert.equal((await H.startTest({ itemId, stationId: H.STATION_INTAKE, actionUuid: randomUUID() })).status, 200);
    const res = await H.submitResult({ ItemID: itemId, StationID: H.STATION_INTAKE, CurrentRouteStep: 1, RouteStepsLength: 1, SubmitID: randomUUID(), Passed: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const queued = (await H.intervals(itemId)).filter((i) => i.state_key === "queued");
    assert.equal(queued.length, 2, "the real wait and the #9 pass-through row are both in the ledger");
    assert.ok(queued.some((i) => i.exit_reason === "result_submitted"), "the pass-through row exits on #10");

    const [w] = await waitFlow();
    assert.equal(w.n, 1, "Q4: only the real wait is a wait");
    assert.equal(w.steps_processed, 1);
    const k = await kpi();
    assert.equal(k.wait_n, 1, "Q5: only the real wait is a wait");
    assert.equal(k.busy_n, 1);
  });

  it("an opened box: one row on the opening bench, and its hop through the closing queue is not a wait", async () => {
    await H.q(
      `INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order)
       VALUES ($1, $2, 2, 1, 0), ($1, $3, 1, 1, 1)`,
      [BOX_TYPE, H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT],
    );
    await H.q(`INSERT INTO shipment_items (shipment_id, item_type_id, quantity) VALUES ($1, $2, 1)`, [H.SHIPMENT_ID, BOX_TYPE]);
    await H.h().prisma.$transaction((tx: any) => boxes.syncShipmentBoxes(tx, H.SHIPMENT_ID));
    const [{ item_id: boxId }] = await H.q<{ item_id: string }>(
      "SELECT item_id::text FROM items WHERE shipment_id = $1 AND package_id IS NULL", [H.SHIPMENT_ID]);
    await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    const members = await H.q<{ item_id: string }>("SELECT item_id::text FROM items WHERE package_id = $1 ORDER BY item_id", [boxId]);
    assert.equal(members.length, 3);

    // Waiting for the opening: the ledger holds 4 queued rows (box + 3 hidden
    // items); the opening station's queue is the box.
    assert.equal((await board(H.STATION_INTAKE)).shared_type_queue, 1, "one box waits at the opening");

    const started = await H.startTest({ itemId: Number(boxId), stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const bench = await board(H.STATION_INTAKE);
    assert.equal(bench.in_test, 1, "one box on the bench, not 1 + 3");
    assert.equal(bench.shared_type_queue, 0);

    const { PUT } = await import("../../../api/packages/[id]/contents/route");
    const saved = await PUT(
      new Request(`http://localhost/api/packages/${boxId}/contents`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: members.map((m, i) => ({ itemId: m.item_id, serialNumber: `PT-${i}` })), remove: [], add: [] }),
      }),
      { params: Promise.resolve({ id: boxId }) },
    );
    assert.equal(saved.status, 200);
    const submitId = randomUUID();
    for (const m of members) {
      const r = await H.submitResult({ ItemID: Number(m.item_id), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { opening: true, package_id: boxId } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const boxRes = await H.submitResult({ ItemID: Number(boxId), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { opening: true } });
    assert.equal(boxRes.body.packageGate?.status, 6, "the box waits for its items");

    const hop = (await H.intervals(Number(boxId))).filter((i) => i.state_key === "queued" && i.exit_reason === "package_items_pending");
    assert.equal(hop.length, 1, "the box's #9 hop through the closing queue is in the ledger");

    // Closed waits: the box and its 3 items waited for the opening. The hop is not a wait.
    const [w] = await waitFlow();
    assert.equal(w.n, 4);
    const k = await kpi();
    // 4 closed opening waits + 3 items now queued at FUNC + the box in status 6.
    assert.equal(k.wait_n, 8);
    assert.equal(bench.active_test_age_wall_min != null, true);
    const idle = await board(H.STATION_FUNC_B);
    assert.equal(idle.active_test_age_wall_min, null);
    assert.equal(idle.active_test_age_work_min, null, "an idle station's work clock is NULL like its wall clock, not 0");
  });
});
