// A shipment's boxes follow its lines (docs/packages/PLAN.md §6, 2026-10-27):
// every box keeps the line — the certificate row — it was minted for, an edit
// touches only the lines it changes, and the opening station's row scan puts
// a box whose label was stuck on another row's box back on its row. Against a
// real database.
//
// Runs ONLY with TEST_DATABASE_URL (a throwaway database carrying every
// migration); borrows the write-path harness and its fixture.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as H from "../../metrics/__tests__/write-path-helpers";

const BOX_TYPE = H.ITEM_TYPE_PACKAGE_CLOSE; // route [INTAKE, CLOSE]
const OTHER_CUSTOMER = 8;

type Boxes = typeof import("../boxes");
type Lines = typeof import("../../shipments/lines");
let boxes: Boxes;
let lines: Lines;

const ROW1 = "1|M-1|SONY|V1|111||1|1|PO-1|SHIP-1";
const ROW2 = "2|M-2|SONY|V2|222||1|1|PO-2|SHIP-1";

const tx = <T>(fn: (tx: any) => Promise<T>) => H.h().prisma.$transaction(fn) as Promise<T>;
const sync = () => tx((t) => boxes.syncShipmentBoxes(t, H.SHIPMENT_ID));

/** Saves the shipment's lines as a form would send them, then syncs its boxes. */
async function save(sent: Record<string, unknown>[]) {
  const input = lines.readShipmentLines(sent, "SHIP-1");
  return tx(async (t) => {
    const gone = await lines.saveShipmentLines(t, H.SHIPMENT_ID, input);
    const synced = await boxes.syncShipmentBoxes(t, H.SHIPMENT_ID);
    return { ...synced, removed: [...gone, ...synced.removed] };
  });
}

const line = (row: string, extra: Record<string, unknown> = {}) => ({
  item_type_id: BOX_TYPE, quantity: 1, makat: row.split("|")[4], model: row.split("|")[3], manufacturer_name: "SONY",
  cert_row_no: row.split("|")[0], cert_row_raw: row, ...extra,
});

const boxRows = () =>
  H.q<{ item_id: string; shipment_item_id: number | null; makat: string; customer_id: number; routed: boolean }>(
    `SELECT i.item_id::text, i.shipment_item_id, i.makat, i.customer_id, (ir.item_id IS NOT NULL) AS routed
     FROM items i LEFT JOIN item_routes ir ON ir.item_id = i.item_id
     WHERE i.shipment_id = $1 AND i.package_id IS NULL ORDER BY i.item_id`, [H.SHIPMENT_ID]);
const lineIds = async () => (await H.q<{ id: number }>("SELECT id FROM shipment_items WHERE shipment_id = $1 ORDER BY id", [H.SHIPMENT_ID])).map((r) => r.id);

describe("shipment boxes follow their lines", { skip: H.skipReason() }, () => {
  before(async () => {
    await H.setup();
    boxes = await import("../boxes");
    lines = await import("../../shipments/lines");
  });
  after(async () => {
    await H.teardown();
  });

  beforeEach(async () => {
    await H.resetDb();
    await H.q("INSERT INTO customers (id, name, customer_code) VALUES ($1, 'OTHER', 'CUST-2')", [OTHER_CUSTOMER]);
    await H.q(
      `INSERT INTO package_contents (package_type_id, item_type_id, quantity, route_number, sort_order) VALUES ($1, $2, 1, 1, 0)`,
      [BOX_TYPE, H.ITEM_TYPE_IN_BOX],
    );
  });

  it("1. each box keeps its own line; removing row 1 removes row 1's box, not the newest", async () => {
    await save([line(ROW1), line(ROW2)]);
    const [l1, l2] = await lineIds();
    let bs = await boxRows();
    assert.equal(bs.length, 2);
    const box1 = bs.find((b) => b.shipment_item_id === l1)!;
    const box2 = bs.find((b) => b.shipment_item_id === l2)!;
    assert.equal(box1.makat, "111");
    assert.equal(box2.makat, "222");

    const r = await save([line(ROW2, { line_id: l2 })]);
    assert.deepEqual(r.removed, [box1.item_id], "the removed box is row 1's");
    bs = await boxRows();
    assert.equal(bs.length, 1);
    assert.equal(bs[0].item_id, box2.item_id, "row 2's box keeps its id — its label still scans");
    assert.equal(bs[0].makat, "222", "and keeps row 2's details");
  });

  it("2. a line edited in place keeps its boxes; fewer boxes removes the newest of that line", async () => {
    await save([line(ROW1, { quantity: 3 })]);
    const [l1] = await lineIds();
    const before = (await boxRows()).map((b) => b.item_id);
    const r = await save([line(ROW1, { line_id: l1, quantity: 2, makat: "111-FIXED" })]);
    assert.deepEqual(r.removed, [before[2]], "the newest box goes");
    const bs = await boxRows();
    assert.deepEqual(bs.map((b) => b.item_id), before.slice(0, 2));
    assert.ok(bs.every((b) => b.makat === "111-FIXED" && b.shipment_item_id === l1), "pending boxes take the edited details");
  });

  it("3. all boxes of a line minted together: consecutive counters, one reservation", async () => {
    const r = await save([line(ROW1, { quantity: 300 })]);
    assert.equal(r.created, 300);
    const bs = await boxRows();
    assert.equal(bs.length, 300);
    const counters = bs.map((b) => Number(b.item_id.slice(10, 14))).sort((a, b) => a - b);
    assert.deepEqual(counters, Array.from({ length: 300 }, (_, k) => counters[0] + k));
    const [day] = await H.q<{ counter: number }>("SELECT counter FROM daily_counters ORDER BY date_key DESC LIMIT 1");
    assert.equal(day.counter, counters[299]);
  });

  it("4. taken-in boxes: their line cannot go or change type, and fewer than were taken in is refused", async () => {
    await save([line(ROW1, { quantity: 3 })]);
    const [l1] = await lineIds();
    const [b1, b2, b3] = await boxRows();
    await tx((t) => boxes.intakeBox(t, BigInt(b1.item_id)));
    await tx((t) => boxes.intakeBox(t, BigInt(b2.item_id)));

    await assert.rejects(save([line(ROW2)]), (e: any) => e.code === "SHIPMENT_LINE_TAKEN_IN");
    await assert.rejects(save([line(ROW1, { line_id: l1, item_type_id: H.ITEM_TYPE_PACKAGE })]), (e: any) => e.code === "SHIPMENT_LINE_TAKEN_IN");
    await assert.rejects(save([line(ROW1, { line_id: l1, quantity: 1 })]), (e: any) => e.code === "SHIPMENT_BOXES_TAKEN_IN");
    const kept = await save([line(ROW1, { line_id: l1, quantity: 2 })]);
    assert.deepEqual(kept.removed, [b3.item_id], "only the pending box goes");
    assert.deepEqual((await boxRows()).map((b) => b.item_id), [b1.item_id, b2.item_id]);
  });

  it("5. a new customer re-mints the pending boxes under it", async () => {
    await save([line(ROW1, { quantity: 2 })]);
    const [l1] = await lineIds();
    const old = (await boxRows()).map((b) => b.item_id);
    await H.q("UPDATE shipments SET customer_id = $1 WHERE id = $2", [OTHER_CUSTOMER, H.SHIPMENT_ID]);
    const r = await save([line(ROW1, { line_id: l1, quantity: 2 })]);
    assert.equal(r.reminted, 2);
    assert.deepEqual(r.removed, []);
    const bs = await boxRows();
    assert.equal(bs.length, 2);
    assert.ok(bs.every((b) => b.customer_id === OTHER_CUSTOMER && b.item_id.slice(1, 4) === "008" && !old.includes(b.item_id)));
  });

  it("6. a box no line claims (minted before boxes were linked) is adopted, or removed when nothing has room", async () => {
    await save([line(ROW1, { quantity: 1 })]);
    await H.q("UPDATE items SET shipment_item_id = NULL WHERE shipment_id = $1", [H.SHIPMENT_ID]);
    const [l1] = await lineIds();
    await sync();
    assert.deepEqual((await boxRows()).map((b) => b.shipment_item_id), [l1]);
    await H.q("UPDATE items SET shipment_item_id = NULL WHERE shipment_id = $1", [H.SHIPMENT_ID]);
    await H.q("UPDATE shipment_items SET quantity = 1, item_type_id = $1 WHERE id = $2", [H.ITEM_TYPE_PACKAGE, l1]);
    const r = await sync();
    assert.equal(r.removed.length, 1, "a pending box of a type no line declares goes");
    assert.equal(r.created, 1, "and the line gets a box of its own type");
  });

  it("7. the opening's row scan: a label on the wrong row's box is put right, with a partner swap", async () => {
    await save([line(ROW1), line(ROW2)]);
    const [l1, l2] = await lineIds();
    const bs = await boxRows();
    const a = bs.find((b) => b.shipment_item_id === l1)!;
    const b = bs.find((b) => b.shipment_item_id === l2)!;
    await tx((t) => boxes.intakeBox(t, BigInt(a.item_id)));
    await tx((t) => boxes.intakeBox(t, BigInt(b.item_id)));

    // Box A is physically row 2's: its row is scanned at it.
    const res = await tx((t) => boxes.bindCertificateRow(t, BigInt(a.item_id), `2^${ROW2}`));
    assert.equal(res.matched, true);
    assert.equal(res.moved, true);
    assert.equal(res.details?.makat, "222");
    const after = await boxRows();
    assert.equal(after.find((x) => x.item_id === a.item_id)!.shipment_item_id, l2);
    assert.equal(after.find((x) => x.item_id === b.item_id)!.shipment_item_id, l1, "B, not opened yet, takes A's old row");
    const items = await H.q<{ package_id: string; makat: string }>("SELECT package_id::text, makat FROM items WHERE package_id IN ($1, $2)", [a.item_id, b.item_id]);
    assert.ok(items.filter((i) => i.package_id === a.item_id).every((i) => i.makat === "222"), "A's items take row 2's details");
    assert.ok(items.filter((i) => i.package_id === b.item_id).every((i) => i.makat === "111"), "B's items take row 1's");

    // The same scan again changes nothing.
    const again = await tx((t) => boxes.bindCertificateRow(t, BigInt(a.item_id), `2^${ROW2}`));
    assert.equal(again.moved, false);

    // A row of another certificate is refused; a row the shipment never scanned only fills the serial.
    await assert.rejects(
      tx((t) => boxes.bindCertificateRow(t, BigInt(a.item_id), "2^1|M-1|SONY|V1|111|SN-9|1|1|PO-1|SHIP-OTHER")),
      (e: any) => e.code === "CERT_ROW_OTHER_SHIPMENT",
    );
    const unknown = await tx((t) => boxes.bindCertificateRow(t, BigInt(a.item_id), "2^9|M-9|LG|V9|999|SN-9|1|1|PO-9"));
    assert.equal(unknown.matched, false);
    assert.equal(unknown.serialNumber, "SN-9");
  });

  it("8. the duplicate certificate: the same number, case-blind, and the same customer", async () => {
    const found = await tx((t) => lines.findDuplicateShipment(t, " ship-1 ", H.CUSTOMER_ID));
    assert.equal(found?.id, H.SHIPMENT_ID);
    assert.equal(await tx((t) => lines.findDuplicateShipment(t, "SHIP-1", H.CUSTOMER_ID, H.SHIPMENT_ID)), null, "a shipment is not its own duplicate");
    assert.equal(await tx((t) => lines.findDuplicateShipment(t, "SHIP-1", OTHER_CUSTOMER)), null, "another customer's certificate is another shipment");
  });
});
