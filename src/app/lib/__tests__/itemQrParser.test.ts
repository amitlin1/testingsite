// The equipment barcode of a shipment certificate, as shipment-QR_CODE- builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItemQr, sameShipmentNumber } from "../itemQrParser";

test("parseItemQr: one unit — every column of the row", () => {
  assert.deepEqual(parseItemQr("2^1|123|SONY|145DL|16321545|8564231|1|1|PO-778"), [
    {
      rowNum: "1", manufacturerNo: "123", manufacturer: "SONY", model: "145DL", makat: "16321545", serialNumber: "8564231",
      batchSize: "1", qtyToTest: 1, purchaseOrder: "PO-778", shipmentNumber: null, raw: "1|123|SONY|145DL|16321545|8564231|1|1|PO-778",
    },
  ]);
});

test("parseItemQr: a tenth column is the certificate's shipment number", () => {
  const [row] = parseItemQr("2^1|123|SONY|145DL|16321545|8564231|1|1|PO-778|SH-2041") ?? [];
  assert.equal(row.shipmentNumber, "SH-2041");
  assert.equal(row.purchaseOrder, "PO-778");
  assert.equal(row.raw, "1|123|SONY|145DL|16321545|8564231|1|1|PO-778|SH-2041");
});

test("parseItemQr: a batch row has no serial and says how many to test", () => {
  const [row] = parseItemQr("2^2|124|SONY|145DL|16321545||50|3|PO-779") ?? [];
  assert.equal(row.serialNumber, null);
  assert.equal(row.qtyToTest, 3);
});

test("parseItemQr: every row of a whole-table barcode; a unit's empty quantity is one", () => {
  const rows = parseItemQr("2^1|123|SONY|145DL|16321545|A1|||PO-1^2|124|LG|X2|777|B2|1|1|PO-2");
  assert.equal(rows?.length, 2);
  assert.equal(rows?.[0].qtyToTest, 1);
  assert.equal(rows?.[1].manufacturer, "LG");
});

test("parseItemQr: a batch row whose quantity is not a number has none — nothing guesses 1", () => {
  assert.equal(parseItemQr("2^3|1|SONY|V1|777||10|חמש|PO")?.[0].qtyToTest, null);
  assert.equal(parseItemQr("2^3|1|SONY|V1|777||10||PO")?.[0].qtyToTest, null);
  assert.equal(parseItemQr("2^3|1|SONY|V1|777||10|0|PO")?.[0].qtyToTest, null);
});

test("parseItemQr: no column is required — an all-empty row still reads", () => {
  const [row] = parseItemQr("2^||||||||") ?? [];
  assert.ok(row);
  assert.equal(row.makat, "");
  assert.equal(row.model, null);
  assert.equal(row.manufacturer, "");
  assert.equal(row.serialNumber, null);
  assert.equal(row.qtyToTest, null);
  assert.equal(row.purchaseOrder, "");
  assert.equal(row.shipmentNumber, null);
});

test("parseItemQr: a '|' inside a value or a scan cut short is not a row", () => {
  // The purchase order "PO|778" made eleven columns of a ten-column row.
  assert.equal(parseItemQr("2^1|M-100|SONY|1.2|123456789||10|2|PO|778|SH-1"), null);
  // The scanner paused inside the quantity column: eight columns.
  assert.equal(parseItemQr("2^1|M-100|SONY|1.2|123456789||10|2"), null);
});

test("parseItemQr: anything else is not an equipment barcode", () => {
  assert.equal(parseItemQr("1|SH-15|323|19/10/2026|Dani"), null);
  assert.equal(parseItemQr("2^1|123|SONY"), null);
  assert.equal(parseItemQr("ABC123"), null);
  assert.equal(parseItemQr(""), null);
});

test("sameShipmentNumber: trimmed and case-blind", () => {
  assert.ok(sameShipmentNumber(" sh-2041 ", "SH-2041"));
  assert.ok(!sameShipmentNumber("SH-2041", "SH-2042"));
});
