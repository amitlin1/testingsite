// The equipment barcode of a shipment certificate, as shipment-QR_CODE- builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItemQr } from "../itemQrParser";

test("parseItemQr: one unit — every column of the row", () => {
  assert.deepEqual(parseItemQr("2^1|123|SONY|145DL|16321545|8564231|1|1|PO-778"), [
    {
      rowNum: "1", manufacturerNo: "123", manufacturer: "SONY", model: "145DL", makat: "16321545", serialNumber: "8564231",
      batchSize: "1", qtyToTest: 1, purchaseOrder: "PO-778", raw: "1|123|SONY|145DL|16321545|8564231|1|1|PO-778",
    },
  ]);
});

test("parseItemQr: a batch row has no serial and says how many to test", () => {
  const [row] = parseItemQr("2^2|124|SONY|145DL|16321545||50|3|PO-779") ?? [];
  assert.equal(row.serialNumber, null);
  assert.equal(row.qtyToTest, 3);
});

test("parseItemQr: every row of a whole-table barcode; an empty quantity is one", () => {
  const rows = parseItemQr("2^1|123|SONY|145DL|16321545|A1|||PO-1^2|124|LG|X2|777|B2|1|1|PO-2");
  assert.equal(rows?.length, 2);
  assert.equal(rows?.[0].qtyToTest, 1);
  assert.equal(rows?.[1].manufacturer, "LG");
});

test("parseItemQr: anything else is not an equipment barcode", () => {
  assert.equal(parseItemQr("1|SH-15|323|19/10/2026|Dani"), null);
  assert.equal(parseItemQr("2^1|123|SONY"), null);
  assert.equal(parseItemQr("ABC123"), null);
  assert.equal(parseItemQr(""), null);
});
