// The station queue as the testing screen shows it: what the search keeps, the order, the ribbon,
// the summary, and which rows offer "חזרה לבדיקה הקודמת".
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PackageItemView, PackageView } from "@/app/lib/packages/contract";
import type { QueueRow, TestStationType } from "@/app/lib/testing/contract";
import { ItemStatus } from "@/lib/item-status";
import {
  afterResultStepBack, boxItemStepBack, filterQueue, optionsOf, orderQueue, queueItemStepBack, queueRowOfCode, queueSummary,
} from "../queue/queueModel";

const row = (id: number, over: Partial<QueueRow> = {}): QueueRow => ({
  item_id: id, serial_no: `SN${id}`, item_type_id: 1, item_type_desc: "סוג", package_id: null,
  current_status: ItemStatus.Queued, item_status_desc: "ממתין", current_route_step: 1, processing_start_time: null,
  queue_start_time: "2026-11-24T08:00:00.000Z", route_steps: [10, 20, 30], route_number: 1, test_station_id: null,
  created_at: null, finished_at: null, is_finished: false, customer_id: 7, customer_code: "123", customer_name: "לקוח",
  shipment_id: 9, shipment_code: "SH-9", makat: "MK", manufacturer_name: null, manufacturer_no: null, model: null,
  ...over,
});
const NO_FILTER = { q: "", customer: "", shipment: "", itype: "" };
const ids = (rows: QueueRow[]) => rows.map((r) => r.item_id);

test("a customer is found by its code, never by its name (the name is on the customers page only)", () => {
  const items = [row(1, { customer_code: "410", customer_name: "מפעלי רדאר" })];
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, q: "410" })), [1]);
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, q: "רדאר" })), []);
});

test("the search matches the row's own ids and texts; a sourced label by its id part", () => {
  const items = [row(1111, { makat: "ABC-1" }), row(2222, { serial_no: "XY77" }), row(3333)];
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, q: "abc" })), [1111]);
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, q: " xy77 " })), [2222]);
  // "itemId-sourceId": the suffix is in no field.
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, q: "3333-5" })), [3333]);
  assert.deepEqual(ids(filterQueue(items, NO_FILTER)), [1111, 2222, 3333]);
});

test("a box row is found by its items; an item row is not found by its siblings", () => {
  const pkg = { items: [{ item_id: "5551", serial_no: "INNER-1" }, { item_id: "5552", serial_no: "INNER-2" }] } as PackageView;
  const box = row(5550, { is_package: true, package: pkg });
  const loose = row(5551, { package_id: 5550, package: pkg, serial_no: "INNER-1" });
  const sibling = row(5552, { package_id: 5550, package: pkg, serial_no: "INNER-2" });
  assert.deepEqual(ids(filterQueue([box, sibling], { ...NO_FILTER, q: "inner-1" })), [5550]);
  assert.deepEqual(ids(filterQueue([loose, sibling], { ...NO_FILTER, q: "inner-1" })), [5551]);
});

test("the three filters narrow by id", () => {
  const items = [row(1, { customer_id: 7 }), row(2, { customer_id: 8, shipment_id: 4 }), row(3, { item_type_id: 2 })];
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, customer: "8" })), [2]);
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, shipment: "4" })), [2]);
  assert.deepEqual(ids(filterQueue(items, { ...NO_FILTER, itype: "2" })), [3]);
});

test("order: waiting first by the longest wait, then in test, then the rest; the scanned row first", () => {
  const items = [
    row(1, { current_status: ItemStatus.Done }),
    row(2, { current_status: ItemStatus.InTest, processing_start_time: "2026-11-24T07:00:00.000Z" }),
    row(3, { queue_start_time: "2026-11-24T09:00:00.000Z" }),
    row(4, { current_status: ItemStatus.AwaitResearch, queue_start_time: "2026-11-24T06:00:00.000Z" }),
  ];
  const plain = orderQueue(items, { searching: false, highlightedItemId: null });
  assert.deepEqual(ids(plain.orderedItems), [4, 3, 2, 1]);
  assert.equal(plain.priorityItemId, 4);
  const scanned = orderQueue(items, { searching: false, highlightedItemId: 2 });
  assert.deepEqual(ids(scanned.orderedItems), [2, 4, 3, 1]);
  assert.equal(scanned.priorityItemId, 4, "the ribbon stays on the longest wait");
  assert.equal(orderQueue(items, { searching: true, highlightedItemId: null }).priorityItemId, null, "no ribbon while searching");
});

test("summary: waiting and in-test counts and the earliest wait, over the whole queue", () => {
  const s = queueSummary([
    row(1, { queue_start_time: "2026-11-24T09:00:00.000Z" }),
    row(2, { current_status: ItemStatus.AwaitResearch, queue_start_time: "2026-11-24T06:00:00.000Z" }),
    row(3, { current_status: ItemStatus.InResearch }),
    row(4, { current_status: ItemStatus.Done, queue_start_time: "2026-11-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(s, { waiting: 2, inTest: 1, longestWaitStart: "2026-11-24T06:00:00.000Z" });
});

test("a code typed in the search names a queue row by its id (a label's id part) or its exact serial", () => {
  const items = [row(1111), row(2222, { serial_no: "S-9" })];
  assert.equal(queueRowOfCode(items, "1111-3")?.item_id, 1111);
  assert.equal(queueRowOfCode(items, "S-9")?.item_id, 2222);
  assert.equal(queueRowOfCode(items, "S-"), undefined);
});

test("filter options: distinct, by label, and a selected value that left the queue stays", () => {
  const items = [row(1, { customer_id: 7, customer_name: "בית" }), row(2, { customer_id: 8, customer_name: "אלף" }), row(3, { customer_id: 7 })];
  const opts = optionsOf(items, (it) => it.customer_id, (it) => it.customer_name, "99");
  assert.deepEqual(opts, [
    { value: "99", label: "99 · לא בתור" },
    { value: "8", label: "אלף" },
    { value: "7", label: "בית" },
  ]);
});

test("step back: a waiting item past step 1 goes back to its previous item-level type, for a manager", () => {
  const types: TestStationType[] = [{ id: 10, name: "פתיחה", packageLevel: true }, { id: 20, name: "בדיקה" }, { id: 30, name: "אחרון" }];
  assert.deepEqual(queueItemStepBack(row(1, { current_route_step: 3 }), types, true), { itemId: "1", routeStep: 3, toName: "בדיקה", inBox: false });
  assert.equal(queueItemStepBack(row(1, { current_route_step: 3 }), types, false), null, "managers only");
  assert.equal(queueItemStepBack(row(1, { current_route_step: 2 }), types, true), null, "the step before is the box's");
  assert.equal(queueItemStepBack(row(1, { current_route_step: 1 }), types, true), null, "the first step");
  assert.equal(queueItemStepBack(row(1, { current_route_step: 3, current_status: ItemStatus.InTest }), types, true), null);
  assert.equal(queueItemStepBack(row(1, { current_route_step: 3, is_package: true }), types, true), null, "a whole box");
});

test("step back of a box item: it reached the closing and its step before is its own", () => {
  const it = (over: Partial<PackageItemView>) => ({
    item_id: "1005", arrived_at_closing: true, prev_step_desc: "בדיקה", prev_step_package_level: false,
    current_route_step: 4, current_status: ItemStatus.Queued, ...over,
  }) as PackageItemView;
  // The closing box waits in the queue: steps 1 (opening) · 2 · 3 (closing); the box at step 3.
  const box = row(9, { is_package: true, route_steps: [10, 20, 30], current_route_step: 3 });
  assert.deepEqual(boxItemStepBack(it({}), true, { box }), { itemId: "1005", routeStep: 4, toName: "בדיקה", inBox: true, fromWizard: false });
  assert.deepEqual(boxItemStepBack(it({}), true, "wizard"), { itemId: "1005", routeStep: 4, toName: "בדיקה", inBox: true, fromWizard: true });
  assert.equal(boxItemStepBack(it({}), false, { box }), null, "managers only");
  assert.equal(boxItemStepBack(it({ arrived_at_closing: false }), true, "wizard"), null);
  assert.equal(boxItemStepBack(it({ prev_step_desc: null }), true, "wizard"), null);
  assert.equal(boxItemStepBack(it({ prev_step_package_level: true }), true, "wizard"), null);
  // From the queue only while the box and the item wait at the closing.
  assert.equal(boxItemStepBack(it({}), true, { box: { ...box, current_status: ItemStatus.InTest } }), null, "the closing started");
  assert.equal(boxItemStepBack(it({ current_status: ItemStatus.InTest }), true, { box }), null);
  assert.equal(boxItemStepBack(it({}), true, { box: { ...box, current_route_step: 1 } }), null, "an opening");
  // The wizard asks with its items in test.
  assert.ok(boxItemStepBack(it({ current_status: ItemStatus.InTest }), true, "wizard"));
});

test("step back right after a result: to the test just finished, unless it was the last step, a box's own, or research", () => {
  const type: TestStationType = { id: 20, name: "בדיקה" };
  const next = { nextStation: { testStationId: 5, testStationDesc: "אחרון", stationTypeId: 30, routeStep: 3 } };
  assert.deepEqual(afterResultStepBack(row(1, { current_route_step: 2 }), type, next, true), { itemId: "1", routeStep: 3, toName: "בדיקה", inBox: false });
  assert.equal(afterResultStepBack(row(1), type, next, false), null, "managers only");
  assert.equal(afterResultStepBack(row(1), type, { ...next, isLastStation: true }, true), null);
  assert.equal(afterResultStepBack(row(1), type, {}, true), null);
  assert.equal(afterResultStepBack(row(1), { ...type, packageLevel: true }, next, true), null);
  assert.equal(afterResultStepBack(row(1, { current_status: ItemStatus.InResearch }), type, next, true), null);
});
