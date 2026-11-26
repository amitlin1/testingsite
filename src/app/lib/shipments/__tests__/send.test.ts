// Returning a shipment (lib/shipments/send.ts): how much of a declared line
// went out, and how much one more send may take.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maxToSend, remainingLines, sendProgress, sentOf } from "../send";

const lines = [
  { item_type_id: 5, makat: "111", quantity: 4, item_type_desc: "ערכה" },
  { item_type_id: 6, makat: null, quantity: 2, item_type_desc: "מארז" },
];

test("sentOf: every send of the type and makat, a blank makat the same as none", () => {
  const sent = [
    { item_type_id: 5, makat: "111", amount: 1 },
    { item_type_id: 5, makat: "111", amount: 2 },
    { item_type_id: 5, makat: "222", amount: 9 },
    { item_type_id: 6, makat: null, amount: 1 },
  ];
  assert.equal(sentOf(sent, 5, "111"), 3);
  assert.equal(sentOf(sent, 6, ""), 1);
  assert.equal(sentOf(sent, 7, null), 0);
});

test("maxToSend: declared minus already sent, never below 0; an undeclared type takes none", () => {
  assert.equal(maxToSend(lines, [{ item_type_id: 5, makat: "111", amount: 1 }], 5, "111"), 3);
  assert.equal(maxToSend(lines, [{ item_type_id: 6, makat: null, amount: 5 }], 6, null), 0);
  assert.equal(maxToSend(lines, [], 9, null), 0);
});

test("sendProgress: each declared line with what went out of it", () => {
  assert.deepEqual(sendProgress(lines, [{ item_type_id: 5, makat: "111", amount: 2 }]), [
    { desc: "ערכה", makat: "111", sent: 2, received: 4 },
    { desc: "מארז", makat: null, sent: 0, received: 2 },
  ]);
});

test("remainingLines: one line per type and makat with what may still go; nothing left, no line", () => {
  const twice = [...lines, { item_type_id: 5, makat: "111", quantity: 9, item_type_desc: "ערכה" }];
  assert.deepEqual(remainingLines(twice, [{ item_type_id: 6, makat: null, amount: 2 }, { item_type_id: 5, makat: "111", amount: 1 }]), [
    { item_type_id: 5, makat: "111", amount: 3 },
  ], "the second 111 line is counted against the first, as a send is; type 6 is all sent");
  assert.deepEqual(remainingLines([{ item_type_id: 6, makat: "", quantity: 2 }], []), [{ item_type_id: 6, makat: null, amount: 2 }]);
});
