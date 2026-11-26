// Who may delete a shipment (lib/shipments/delete.ts) — the row's rule, the
// same one DELETE /api/shipments/[id] applies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shipmentDeleteRule } from "../delete";

test("a sent shipment is never deleted, not even by a manager", () => {
  assert.deepEqual(shipmentDeleteRule({ is_sent: true, sampled_amount: 0 }, true), { kind: "blocked", reason: "לא ניתן למחוק משלוח שנשלח" });
});

test("nothing taken in: anyone deletes it, plainly", () => {
  assert.deepEqual(shipmentDeleteRule({ is_sent: false, sampled_amount: 0 }, false), { kind: "plain" });
  assert.deepEqual(shipmentDeleteRule({}, true), { kind: "plain" });
});

test("boxes taken in: only a manager, told how many go with it", () => {
  assert.equal(shipmentDeleteRule({ sampled_amount: 2 }, false).kind, "blocked");
  assert.deepEqual(shipmentDeleteRule({ sampled_amount: 2 }, true), { kind: "withTakenIn", takenIn: 2 });
});
