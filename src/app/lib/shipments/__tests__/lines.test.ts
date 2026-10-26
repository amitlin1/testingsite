// What the shipment forms send, checked before anything is written (lib/shipments/lines.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SHIPMENT_BOXES, matchSavedLines, readShipmentLines } from "../lines";
import { mintOrderKey } from "../../packages/ids";

const code = (e: unknown) => (e as { code?: string }).code;

test("readShipmentLines: a whole line keeps its id and its certificate row", () => {
  const [l] = readShipmentLines([{ line_id: 12, item_type_id: 5, quantity: 2, cert_row_raw: "1|M|SONY|V|111||10|2|PO|SH-1" }], "sh-1");
  assert.equal(l.lineId, 12);
  assert.equal(l.itemTypeId, 5);
  assert.equal(l.quantity, 2);
  assert.equal(l.details.cert_row_raw, "1|M|SONY|V|111||10|2|PO|SH-1");
});

test("readShipmentLines: a started line without a type or a quantity is refused, never dropped", () => {
  assert.throws(() => readShipmentLines([{ item_type_id: 0, quantity: 2 }], "S"), (e) => code(e) === "SHIPMENT_LINE_TYPE");
  assert.throws(() => readShipmentLines([{ item_type_id: 5, quantity: 0 }], "S"), (e) => code(e) === "SHIPMENT_LINE_QUANTITY");
  assert.throws(() => readShipmentLines([{ item_type_id: 5, quantity: 1.5 }], "S"), (e) => code(e) === "SHIPMENT_LINE_QUANTITY");
});

test("readShipmentLines: a row of another certificate, or the same row twice, is refused", () => {
  assert.throws(
    () => readShipmentLines([{ item_type_id: 5, quantity: 1, cert_row_raw: "1|M|SONY|V|111||1|1|PO|SH-2" }], "SH-1"),
    (e) => code(e) === "CERT_ROW_OTHER_SHIPMENT",
  );
  const row = "1|M|SONY|V|111||1|1|PO";
  assert.throws(
    () => readShipmentLines([{ item_type_id: 5, quantity: 1, cert_row_raw: row }, { item_type_id: 5, quantity: 1, cert_row_raw: row }], "SH-1"),
    (e) => code(e) === "SHIPMENT_LINE_TWICE",
  );
  // A row printed before certificates carried their shipment number passes.
  assert.equal(readShipmentLines([{ item_type_id: 5, quantity: 1, cert_row_raw: row }], "SH-1").length, 1);
});

test("readShipmentLines: past the most boxes a shipment may declare", () => {
  assert.throws(() => readShipmentLines([{ item_type_id: 5, quantity: MAX_SHIPMENT_BOXES + 1 }], "S"), (e) => code(e) === "SHIPMENT_TOO_BIG");
});

test("mintOrderKey: minting order, not the id's own order (ddMMyy, customer first)", () => {
  const oct31 = "1007311026000500"; // 31/10/26, counter 5
  const nov1 = "1007011126000100"; // 01/11/26, counter 1
  assert.ok(BigInt(nov1) < BigInt(oct31), "the id alone puts November first");
  assert.ok(mintOrderKey(nov1) > mintOrderKey(oct31), "minting order puts it last");
  assert.ok(mintOrderKey("1007311026000600") > mintOrderKey(oct31), "same day: by the counter");
  assert.ok(mintOrderKey("123456") < mintOrderKey(oct31), "a legacy id sorts first");
});

test("matchSavedLines: line_id first, then the same certificate row, then — for a client without ids — the type, in order", () => {
  const saved = [
    { id: 1, item_type_id: 5, cert_row_raw: "1|A" },
    { id: 2, item_type_id: 5, cert_row_raw: null },
    { id: 3, item_type_id: 6, cert_row_raw: null },
  ];
  const line = (o: { lineId?: number | null; itemTypeId: number; raw?: string | null }) =>
    ({ lineId: o.lineId ?? null, itemTypeId: o.itemTypeId, details: { cert_row_raw: o.raw ?? null } }) as never;
  // The form sends ids: a line without one is new, even of a type with a free saved line.
  assert.deepEqual(matchSavedLines([line({ lineId: 2, itemTypeId: 5 }), line({ itemTypeId: 6 })], saved, true), [2, null]);
  // … also when every saved line was removed and only new ones are sent.
  assert.deepEqual(matchSavedLines([line({ itemTypeId: 6 }), line({ itemTypeId: 5 })], saved, true), [null, null]);
  // The same certificate row is the same line.
  assert.deepEqual(matchSavedLines([line({ lineId: 3, itemTypeId: 6 }), line({ itemTypeId: 5, raw: "1|A" })], saved, true), [3, 1]);
  // An older client (no ids): by row, then by type in order.
  assert.deepEqual(matchSavedLines([line({ itemTypeId: 6 }), line({ itemTypeId: 5 }), line({ itemTypeId: 5, raw: "1|A" })], saved, false), [3, 2, 1]);
  // An id of another shipment's line is not this shipment's.
  assert.deepEqual(matchSavedLines([line({ lineId: 99, itemTypeId: 5 })], saved, true), [null]);
});
