// The queue as a tree: customer › shipment › rows, which node a URL names, and what the open
// node shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { QueueRow, ShipmentProgress } from "@/app/lib/testing/contract";
import { ItemStatus } from "@/lib/item-status";
import {
  NO_KEY, buildTree, customerLabel, nearestNode, nextToStart, nodeInTree, nodeOf, rowsOfNode, shipmentNodeOf, urlOfNode, waitLabel,
} from "../queue/treeModel";

const row = (id: number, over: Partial<QueueRow> = {}): QueueRow => ({
  item_id: id, serial_no: `SN${id}`, item_type_id: 1, item_type_desc: "סוג", package_id: null,
  current_status: ItemStatus.Queued, item_status_desc: "ממתין", current_route_step: 1, processing_start_time: null,
  queue_start_time: "2026-11-24T08:00:00.000Z", route_steps: [10, 20, 30], route_number: 1, test_station_id: null,
  created_at: null, finished_at: null, is_finished: false, customer_id: 7, customer_code: "410", customer_name: "שם",
  shipment_id: 9, shipment_code: "7731", makat: "MK", manufacturer_name: null, manufacturer_no: null, model: null,
  ...over,
});
const NONE = new Map<number, ShipmentProgress>();
const ids = (rows: QueueRow[]) => rows.map((r) => r.item_id);

test("rows group by customer, then shipment, with counts and the longest wait of each", () => {
  const items = [
    row(1, { queue_start_time: "2026-11-24T09:00:00.000Z" }),
    row(2, { queue_start_time: "2026-11-24T07:00:00.000Z" }),
    row(3, { shipment_id: 10, shipment_code: "7742", current_status: ItemStatus.InTest }),
    row(4, { customer_id: 8, customer_code: "520", shipment_id: 11, shipment_code: "7728" }),
  ];
  const tree = buildTree(items, NONE, "code");
  assert.deepEqual(tree.map((c) => [c.code, c.count, c.waiting]), [["410", 3, 2], ["520", 1, 1]]);
  const c410 = tree[0];
  assert.equal(c410.oldestWaitStart, "2026-11-24T07:00:00.000Z");
  assert.deepEqual(c410.shipments.map((s) => [s.code, s.count, s.waiting]), [["7731", 2, 2], ["7742", 1, 0]]);
  // In test only: nothing waits, so no wait clock.
  assert.equal(c410.shipments[1].oldestWaitStart, null);
});

test("by wait: the customer with the longest-waiting row first, a customer with nothing waiting last", () => {
  const items = [
    row(1, { customer_id: 1, customer_code: "100", queue_start_time: "2026-11-24T10:00:00.000Z" }),
    row(2, { customer_id: 2, customer_code: "200", queue_start_time: "2026-11-24T06:00:00.000Z" }),
    row(3, { customer_id: 3, customer_code: "300", current_status: ItemStatus.InTest }),
  ];
  assert.deepEqual(buildTree(items, NONE, "wait").map((c) => c.code), ["200", "100", "300"]);
  assert.deepEqual(buildTree(items, NONE, "code").map((c) => c.code), ["100", "200", "300"]);
});

test("customer codes sort as numbers, and a row with no customer or shipment still has a branch", () => {
  const items = [
    row(1, { customer_id: 1, customer_code: "90" }),
    row(2, { customer_id: 2, customer_code: "410" }),
    row(3, { customer_id: null, customer_code: null, shipment_id: null, shipment_code: null }),
  ];
  const tree = buildTree(items, NONE, "code");
  assert.deepEqual(tree.map((c) => c.key), ["1", "2", NO_KEY]);
  assert.equal(tree[2].shipments[0].key, NO_KEY);
  assert.equal(customerLabel(tree[2].code), "ללא לקוח");
});

test("a shipment carries the progress the server answered for it, and none when it did not answer", () => {
  const progress = new Map<number, ShipmentProgress>([[9, { shipmentId: 9, shipmentCode: "7731", receivedAt: null, total: 12, done: 5 }]]);
  const tree = buildTree([row(1), row(2, { shipment_id: 10, shipment_code: "7742" })], progress, "code");
  assert.deepEqual(tree[0].shipments.map((s) => s.progress?.done ?? null), [5, null]);
});

test("the URL keys name a node, and back", () => {
  assert.deepEqual(nodeOf("", ""), { kind: "all" });
  assert.deepEqual(nodeOf("", "9"), { kind: "all" });
  assert.deepEqual(nodeOf("7", ""), { kind: "customer", customer: "7" });
  assert.deepEqual(nodeOf("7", "9"), { kind: "shipment", customer: "7", shipment: "9" });
  assert.deepEqual(urlOfNode({ kind: "shipment", customer: "7", shipment: "9" }), { customer: "7", shipment: "9" });
  assert.deepEqual(shipmentNodeOf(row(1)), { kind: "shipment", customer: "7", shipment: "9" });
});

test("a node the queue no longer holds is not in the tree; the screen shows the nearest one it does", () => {
  const tree = buildTree([row(1)], NONE, "code");
  assert.equal(nodeInTree(tree, { kind: "shipment", customer: "7", shipment: "9" }), true);
  assert.equal(nodeInTree(tree, { kind: "shipment", customer: "7", shipment: "99" }), false);
  assert.equal(nodeInTree(tree, { kind: "customer", customer: "8" }), false);
  // The shipment's last row was just tested: back to its customer; a customer gone: the whole queue.
  assert.deepEqual(nearestNode(tree, { kind: "shipment", customer: "7", shipment: "99" }), { kind: "customer", customer: "7" });
  assert.deepEqual(nearestNode(tree, { kind: "shipment", customer: "8", shipment: "9" }), { kind: "all" });
  assert.deepEqual(nearestNode(tree, { kind: "shipment", customer: "7", shipment: "9" }), { kind: "shipment", customer: "7", shipment: "9" });
});

test("the open node's rows: waiting first, the longest wait first; the next to start is the first waiting", () => {
  const items = [
    row(1, { current_status: ItemStatus.InTest, processing_start_time: "2026-11-24T05:00:00.000Z" }),
    row(2, { queue_start_time: "2026-11-24T09:00:00.000Z" }),
    row(3, { queue_start_time: "2026-11-24T07:00:00.000Z" }),
    row(4, { shipment_id: 10, queue_start_time: "2026-11-24T06:00:00.000Z" }),
    row(5, { customer_id: 8 }),
  ];
  assert.deepEqual(ids(rowsOfNode(items, { kind: "shipment", customer: "7", shipment: "9" })), [3, 2, 1]);
  assert.deepEqual(ids(rowsOfNode(items, { kind: "customer", customer: "7" })), [4, 3, 2, 1]);
  assert.equal(rowsOfNode(items, { kind: "all" }).length, 5);
  assert.equal(nextToStart(rowsOfNode(items, { kind: "shipment", customer: "7", shipment: "9" }))?.item_id, 3);
  assert.equal(nextToStart([row(1, { current_status: ItemStatus.InTest })]), undefined);
});

test("a wait reads in minutes under an hour, in hours after", () => {
  assert.equal(waitLabel(12 * 60 + 30), "12 דק׳");
  assert.equal(waitLabel(84 * 60), "1:24 שע׳");
});
