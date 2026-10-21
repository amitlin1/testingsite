// The opening of a box from its shipment, end to end, against a real database
// (docs/packages/PLAN.md §6): shipment line → pending box → intake → group
// start → "תכולה וסריאליים" (PUT /api/packages/[id]/contents) → one result per
// item and the box. Plus the ways it can be refused, the stale-test reaper in
// the middle of a long opening, and a reopened wizard after the items were
// already submitted.
//
// Runs ONLY with TEST_DATABASE_URL (a throwaway database carrying every
// migration); borrows the write-path harness and its fixture.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as H from "../../metrics/__tests__/write-path-helpers";

const BOX_TYPE = H.ITEM_TYPE_PACKAGE_CLOSE; // route [INTAKE, CLOSE]
const CERT = { makat: "CERT-MK", model: "CERT-MODEL", manufacturer_name: "CERT-MFR", manufacturer_no: "CERT-NO" };
const detailsOf = (r: { makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null }) =>
  [r.makat, r.model, r.manufacturer_name, r.manufacturer_no].map((v) => (v ?? "").trim()).join("|");
const CERT_LINE = detailsOf(CERT);

type Boxes = typeof import("../boxes");
let boxes: Boxes;
let putContents: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

async function contents(boxId: string, body: unknown) {
  const res = await putContents(
    new Request(`http://localhost/api/packages/${boxId}/contents`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: boxId }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

const members = (boxId: string) =>
  H.q<{ item_id: string; item_type_id: number; serial_no: string | null; makat: string | null; model: string | null; manufacturer_name: string | null; manufacturer_no: string | null }>(
    "SELECT item_id::text, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no FROM items WHERE package_id = $1 ORDER BY item_id", [boxId]);

describe("package opening from the shipment", { skip: H.skipReason() }, () => {
  before(async () => {
    await H.setup();
    boxes = await import("../boxes");
    putContents = (await import("../../../api/packages/[id]/contents/route")).PUT as typeof putContents;
  });
  after(async () => {
    await H.q("DELETE FROM file_objects WHERE object_key LIKE 'opening-flow-test/%'");
    await H.teardown();
  });

  let boxId = "";
  beforeEach(async () => {
    await H.resetDb();
    // A template that still carries details of its own (as templates did
    // before 2026-10-20): 2 × IN_BOX, 1 × IN_BOX_ALT.
    await H.q(
      `INSERT INTO package_contents (package_type_id, item_type_id, quantity, makat, model, manufacturer_name, manufacturer_no, route_number, sort_order)
       VALUES ($1, $2, 2, 'TPL-MK', 'TPL-MODEL', 'TPL-MFR', 'TPL-NO', 1, 0), ($1, $3, 1, NULL, NULL, NULL, NULL, 1, 1)`,
      [BOX_TYPE, H.ITEM_TYPE_IN_BOX, H.ITEM_TYPE_IN_BOX_ALT],
    );
    // The shipment line as a scanned certificate row leaves it.
    await H.q(
      `INSERT INTO shipment_items (shipment_id, item_type_id, quantity, makat, model, manufacturer_name, manufacturer_no, cert_row_no, cert_row_raw)
       VALUES ($1, $2, 1, $3, $4, $5, $6, '1', '1|CERT-NO|CERT-MFR|CERT-MODEL|CERT-MK||1|1|PO-1')`,
      [H.SHIPMENT_ID, BOX_TYPE, CERT.makat, CERT.model, CERT.manufacturer_name, CERT.manufacturer_no],
    );
    const synced = await H.h().prisma.$transaction((tx: any) => boxes.syncShipmentBoxes(tx, H.SHIPMENT_ID));
    assert.equal(synced.created, 1);
    const [box] = await H.q<{ item_id: string }>("SELECT item_id::text FROM items WHERE shipment_id = $1 AND package_id IS NULL", [H.SHIPMENT_ID]);
    boxId = box.item_id;
  });

  it("1. intake: every item takes the box's details (the certificate row), never the template's", async () => {
    const [box] = await H.q("SELECT makat, model, manufacturer_name, manufacturer_no FROM items WHERE item_id = $1", [boxId]);
    assert.equal(detailsOf(box as any), CERT_LINE, "the pending box carries its line's details");
    const created = await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    assert.equal(created.itemIds.length, 3);
    const items = await members(boxId);
    assert.deepEqual(items.map(detailsOf), [CERT_LINE, CERT_LINE, CERT_LINE]);
    assert.ok(items.every((i) => i.serial_no == null), "no serials before the opening");
  });

  it("2. the whole opening: start, contents (refusals, removal, an added item, a second save), results", async () => {
    await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    const [a, b, c] = await members(boxId);

    const started = await H.startTest({ itemId: Number(boxId), stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.item.startedPackageItems.length, 3);

    const kept = (serials: [string, string, string]) => [a, b, c].map((it, i) => ({
      itemId: it.item_id, serialNumber: serials[i], makat: CERT.makat, model: CERT.model, manufacturer: CERT.manufacturer_name, manufacturerNo: CERT.manufacturer_no,
    }));

    // No serial → refused on its row.
    const noSerial = await contents(boxId, { items: kept(["S-A", "", "S-C"]), remove: [], add: [] });
    assert.equal(noSerial.status, 400, JSON.stringify(noSerial.body));
    assert.equal(noSerial.body.code, "ITEM_SERIAL_REQUIRED");
    assert.equal(noSerial.body.itemIndex, 1);
    // The same serial twice in the box → refused.
    const dup = await contents(boxId, { items: kept(["S-A", "s-a", "S-C"]), remove: [], add: [] });
    assert.equal(dup.status, 409, JSON.stringify(dup.body));
    assert.equal(dup.body.code, "ITEM_SERIAL_DUPLICATE");

    // c did not come; b is sent with a model of its own and the added item
    // with details of its own — the details are the shipment's, not the station's.
    const good = await contents(boxId, {
      items: kept(["S-A", "S-B", "S-C"]).slice(0, 2).map((r, i) => (i === 1 ? { ...r, model: "EDITED" } : r)),
      remove: [c.item_id],
      add: [{ itemType: H.ITEM_TYPE_IN_BOX_ALT, serialNumber: "S-NEW", makat: "OTHER-MK", model: "OTHER-MODEL", manufacturer: "OTHER-MFR", manufacturerNo: "OTHER-NO" }],
    });
    assert.equal(good.status, 200, JSON.stringify(good.body));
    let now = await members(boxId);
    assert.equal(now.length, 3);
    assert.ok(!now.some((m) => m.item_id === c.item_id), "c is gone");
    assert.equal(detailsOf(now.find((m) => m.item_id === b.item_id)!), CERT_LINE, "a detail sent by the station is ignored");
    const added = now.find((m) => ![a.item_id, b.item_id].includes(m.item_id))!;
    assert.equal(added.serial_no, "S-NEW");
    assert.equal(detailsOf(added), CERT_LINE, "an added item takes the box's details");

    // Back to the contents step after the photos: a serial changed, saved again.
    const again = await contents(boxId, {
      items: now.map((m) => ({ itemId: m.item_id, serialNumber: m.item_id === a.item_id ? "S-A2" : m.serial_no, makat: m.makat, model: m.model, manufacturer: m.manufacturer_name, manufacturerNo: m.manufacturer_no })),
      remove: [], add: [],
    });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    now = await members(boxId);

    // "הדפס וסיים": one result per item, then the box, under one submit id.
    const submitId = randomUUID();
    for (const m of now) {
      const r = await H.submitResult({ ItemID: Number(m.item_id), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { opening: true, package_id: boxId } });
      assert.equal(r.status, 200, `item ${m.item_id}: ${JSON.stringify(r.body)}`);
    }
    const boxDone = await H.submitResult({ ItemID: Number(boxId), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true, Details: { opening: true } });
    assert.equal(boxDone.status, 200, JSON.stringify(boxDone.body));
    assert.equal(boxDone.body.packageGate?.status, 6, "the box waits at its closing step for its items");
    for (const m of now) {
      const r = await H.routeRow(Number(m.item_id));
      assert.equal(r.current_route_step, 2, `item ${m.item_id} at FUNC`);
      assert.equal(r.current_status, H.STATUS.queued);
    }

    // After the opening: the contents are closed.
    const late = await contents(boxId, { items: [], remove: [], add: [] });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, "PACKAGE_NOT_OPENING");
  });

  it("3. a photo already taken of an item: it can still be corrected, not removed — until the photo is taken back", async () => {
    await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    const [a, b, c] = await members(boxId);
    await H.startTest({ itemId: Number(boxId), stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    const all = (s: string) => [a, b, c].map((it, i) => ({ itemId: it.item_id, serialNumber: `${s}-${i}`, makat: CERT.makat, model: CERT.model, manufacturer: CERT.manufacturer_name, manufacturerNo: CERT.manufacturer_no }));
    assert.equal((await contents(boxId, { items: all("S"), remove: [], add: [] })).status, 200);
    // c's photo was uploaded at the items step.
    const photoKey = `opening-flow-test/${c.item_id}-${randomUUID()}`;
    await H.q(
      `INSERT INTO file_objects (bucket, object_key, file_name, entity_type, entity_id, status) VALUES ('test', $1, 'c.jpg', 'item_attachment', $2, 'active')`,
      [photoKey, c.item_id],
    );
    const corrected = await contents(boxId, { items: all("T"), remove: [], add: [] });
    assert.equal(corrected.status, 200, "a photographed item's serial can still be corrected");
    const removed = await contents(boxId, { items: all("T").slice(0, 2), remove: [c.item_id], add: [] });
    assert.equal(removed.status, 409);
    assert.equal(removed.body.code, "ITEM_TOUCHED");
    // About the item, not the box.
    assert.equal(removed.body.error, "לפריט כבר צורפו קבצים — אי אפשר לסמן אותו כ״לא הגיע״");
    // The worker removes the shot: the wizard takes its file back (DELETE
    // /api/items/[id]/files marks it deleted), and the item can go.
    await H.q("UPDATE file_objects SET status = 'deleted', deleted_at = now() WHERE object_key = $1", [photoKey]);
    const gone = await contents(boxId, { items: all("T").slice(0, 2), remove: [c.item_id], add: [] });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal((await members(boxId)).length, 2);
  });

  it("4. a long opening: the reaper releases the box mid-wizard — contents and results still go through", async () => {
    await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    const items = await members(boxId);
    await H.startTest({ itemId: Number(boxId), stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    for (const id of [boxId, ...items.map((i) => i.item_id)]) await H.ageProcessingStart(Number(id), 45);
    const reaped = await H.runReaper();
    assert.equal(reaped.status, 200, JSON.stringify(reaped.body));
    // Past the opening type's 30 minutes the box is back in the queue, its station free.
    assert.equal((await H.routeRow(Number(boxId))).current_status, H.STATUS.queued);

    const saved = await contents(boxId, { items: items.map((m, i) => ({ itemId: m.item_id, serialNumber: `R-${i}`, makat: CERT.makat, model: CERT.model, manufacturer: CERT.manufacturer_name, manufacturerNo: CERT.manufacturer_no })), remove: [], add: [] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const submitId = randomUUID();
    for (const m of items) {
      const r = await H.submitResult({ ItemID: Number(m.item_id), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const boxDone = await H.submitResult({ ItemID: Number(boxId), StationID: H.STATION_INTAKE, SubmitID: submitId, Passed: true });
    assert.equal(boxDone.status, 200, JSON.stringify(boxDone.body));
  });

  it("5. the wizard reopened after its items were submitted but the box was not: no item moves twice, the box still finishes", async () => {
    await H.h().prisma.$transaction((tx: any) => boxes.intakeBox(tx, BigInt(boxId)));
    const items = await members(boxId);
    await H.startTest({ itemId: Number(boxId), stationId: H.STATION_INTAKE, actionUuid: randomUUID() });
    await contents(boxId, { items: items.map((m, i) => ({ itemId: m.item_id, serialNumber: `D-${i}`, makat: CERT.makat, model: CERT.model, manufacturer: CERT.manufacturer_name, manufacturerNo: CERT.manufacturer_no })), remove: [], add: [] });
    // First "הדפס וסיים": the items go through (each with the step it is for,
    // as the wizard sends it), the box's submit never lands.
    const first = randomUUID();
    for (const m of items) {
      const r = await H.submitResult({ ItemID: Number(m.item_id), StationID: H.STATION_INTAKE, SubmitID: first, Passed: true, CurrentRouteStep: 1 });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    assert.equal((await H.routeRow(Number(items[0].item_id))).current_route_step, 2);

    // The wizard opened again on a box view still saying step 1: the server
    // refuses the stale result instead of moving the item a second step.
    const stale = await H.submitResult({ ItemID: Number(items[0].item_id), StationID: H.STATION_INTAKE, SubmitID: randomUUID(), Passed: true, CurrentRouteStep: 1 });
    assert.equal(stale.status, 404, JSON.stringify(stale.body));
    assert.equal((await H.routeRow(Number(items[0].item_id))).current_route_step, 2, "still at FUNC — not moved twice");

    // A fresh view shows every item past the opening (the wizard then counts
    // them as done and sends only the box), and the box finishes.
    const { loadPackage } = await import("../read");
    const view = await loadPackage(BigInt(boxId));
    assert.ok(view?.items.every((it: { current_route_step: number | null }) => (it.current_route_step ?? 1) > 1), "every item has left the opening");
    const boxDone = await H.submitResult({ ItemID: Number(boxId), StationID: H.STATION_INTAKE, SubmitID: randomUUID(), Passed: true, CurrentRouteStep: 1 });
    assert.equal(boxDone.status, 200, JSON.stringify(boxDone.body));
    assert.equal(boxDone.body.packageGate?.status, 6);
  });
});
