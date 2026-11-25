// The shipment forms' line rules (lib/shipments/form.ts): what counts as a
// line, when it can be saved, and how a certificate row becomes one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  certRowLine, certSummary, dateInputValue, declaredBoxes, lineIsEmpty, lineProblem, placeScannedLines, scannedRows,
  type ShipmentLine,
} from "../form";
import type { ParsedItemData } from "@/app/lib/itemQrParser";

const blank: ShipmentLine = { item_type_id: 0, quantity: 0 };

test("lineIsEmpty: only the untouched blank row is empty", () => {
  assert.ok(lineIsEmpty(blank));
  assert.ok(lineIsEmpty(undefined));
  assert.ok(!lineIsEmpty({ item_type_id: 5, quantity: 0 }));
  assert.ok(!lineIsEmpty({ item_type_id: 0, quantity: 2 }));
  assert.ok(!lineIsEmpty({ item_type_id: 0, quantity: 0, cert_row_raw: "1|A" }));
});

test("lineProblem: a started line needs a type and a whole quantity of at least 1", () => {
  assert.equal(lineProblem(blank), null);
  assert.equal(lineProblem({ item_type_id: 0, quantity: 2 }), "יש לבחור סוג מארז");
  assert.equal(lineProblem({ item_type_id: 5, quantity: 0 }), "יש להזין כמות (לפחות 1)");
  assert.equal(lineProblem({ item_type_id: 5, quantity: 1.5 }), "יש להזין כמות (לפחות 1)");
  assert.equal(lineProblem({ item_type_id: 5, quantity: 3 }), null);
});

test("declaredBoxes: the started lines' quantities", () => {
  assert.equal(declaredBoxes([{ item_type_id: 5, quantity: 3 }, blank, { item_type_id: 6, quantity: 2 }]), 5);
  assert.equal(declaredBoxes(undefined), 0);
});

test("scannedRows: the certificate rows already on the form", () => {
  assert.deepEqual(scannedRows([{ item_type_id: 5, quantity: 1, cert_row_raw: "1|A" }, blank]), ["1|A"]);
});

test("placeScannedLines: a blank last line takes the first scanned row, the rest are appended", () => {
  const calls: string[] = [];
  const form = {
    update: (i: number, l: ShipmentLine) => calls.push(`update ${i} ${l.cert_row_raw}`),
    append: (ls: ShipmentLine[]) => calls.push(`append ${ls.map((l) => l.cert_row_raw).join(",")}`),
  };
  const a = { item_type_id: 5, quantity: 1, cert_row_raw: "A" };
  const b = { item_type_id: 5, quantity: 1, cert_row_raw: "B" };
  placeScannedLines([blank], [a, b], form);
  assert.deepEqual(calls, ["update 0 A", "append B"]);

  // A saved line keeps its place even when blanked: everything is appended.
  calls.length = 0;
  placeScannedLines([{ ...blank, line_id: 7 }], [a], form);
  assert.deepEqual(calls, ["append A"]);
});

test("certRowLine: the row's details trimmed, blanks as null, the whole row kept", () => {
  const row: ParsedItemData = {
    rowNum: " 2 ", manufacturerNo: "", manufacturer: "SONY ", makat: "16321545", model: " 145DL", serialNumber: null,
    batchSize: "10", qtyToTest: 2, purchaseOrder: "PO-778", shipmentNumber: "SH-1", raw: "2|...",
  };
  assert.deepEqual(certRowLine(row, { itemTypeId: 5, quantity: 2, makat: " 16321545 " }), {
    item_type_id: 5, quantity: 2, makat: "16321545", model: "145DL", manufacturer_name: "SONY", manufacturer_no: null,
    cert_row_no: "2", serial_no: null, batch_size: "10", qty_to_test: 2, purchase_order: "PO-778", cert_row_raw: "2|...",
  });
  assert.equal(certRowLine(row, { itemTypeId: null, quantity: 1, makat: "" }).item_type_id, 0);
});

test("certSummary: where a line came from, or nothing for type and quantity alone", () => {
  assert.equal(
    certSummary({ item_type_id: 5, quantity: 1, cert_row_raw: "x", cert_row_no: "2", manufacturer_name: "SONY", model: "145DL", makat: "163", purchase_order: "PO" }),
    "מהתעודה · שורה 2 · SONY 145DL · מק״ט 163 · הזמנה PO",
  );
  assert.equal(certSummary({ item_type_id: 5, quantity: 1, makat: "163" }), "הוזן ידנית · מק״ט 163");
  assert.equal(certSummary({ item_type_id: 5, quantity: 1 }), null);
});

test("dateInputValue: the date input's day, on the display clock", () => {
  assert.equal(dateInputValue(new Date("2026-11-24")), "2026-11-24");
  // 22:30 UTC is already the next day in Israel.
  assert.equal(dateInputValue("2026-11-23T22:30:00Z"), "2026-11-24");
});
