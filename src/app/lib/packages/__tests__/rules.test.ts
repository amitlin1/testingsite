// The package model's rules over route rows (docs/features/packages/PLAN.md §4) and the
// view rules the screens share (contract.ts), through their public functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemStatus } from "@/lib/item-status";
import {
  arrivedAtClosing, atGateStep, blocksGate, decisionsOf, isFreshRoute, isOpeningRoute, itemState, itemWhereText, packageStatus,
} from "../rules";
import { isAtOpening, isPackageStatusKey, packageMatches, waitsForItems, type PackageView } from "../contract";
import { boxRouteNumber, itemRouteNumber, parseDefaultRoute, templateSeqRanges } from "../template-wire";
import { readItemInput } from "../input";

const at = (step: number | null, status: number | null, finished = false) =>
  ({ current_route_step: step, current_status: status, is_finished: finished });

test("isOpeningRoute: step 1, waiting or in test there, not finished", () => {
  assert.ok(isOpeningRoute(at(1, ItemStatus.Queued)));
  assert.ok(isOpeningRoute(at(1, ItemStatus.InTest)));
  assert.ok(!isOpeningRoute(at(2, ItemStatus.Queued)));
  assert.ok(!isOpeningRoute(at(1, ItemStatus.AwaitResearch)));
  assert.ok(!isOpeningRoute(at(1, ItemStatus.Queued, true)));
});

test("isFreshRoute: fresh from intake — queued at step 1 and never started", () => {
  assert.ok(isFreshRoute({ ...at(1, ItemStatus.Queued), processing_start_time: null }));
  assert.ok(!isFreshRoute({ ...at(1, ItemStatus.Queued), processing_start_time: new Date() }));
  assert.ok(!isFreshRoute({ ...at(1, ItemStatus.InTest), processing_start_time: null }));
});

test("atGateStep: an unfinished box at a package-level step after its first", () => {
  assert.equal(atGateStep(at(2, ItemStatus.Queued), true), true);
  assert.equal(atGateStep(at(1, ItemStatus.Queued), true), false);
  assert.equal(atGateStep(at(2, ItemStatus.Queued), false), false);
  assert.equal(atGateStep(at(2, ItemStatus.Queued), null), false);
  assert.equal(atGateStep(at(3, ItemStatus.Queued, true), true), false);
});

test("boxRouteNumber / itemRouteNumber: asked, else the type default / template line, else route 1", () => {
  assert.equal(boxRouteNumber(4, 2), 4);
  assert.equal(boxRouteNumber(null, 2), 2);
  assert.equal(boxRouteNumber(undefined, null), 1);
  assert.equal(itemRouteNumber(3, { route_number: 2 }), 3);
  assert.equal(itemRouteNumber(null, { route_number: 2 }), 2);
  assert.equal(itemRouteNumber(null, undefined), 1);
});

test("blocksGate: present when finished or waiting / in test at the gate's type; an orphan row never blocks", () => {
  const gate = 7;
  assert.equal(blocksGate({ current_status: ItemStatus.Queued, is_finished: false, step_type_id: gate }, gate), false);
  assert.equal(blocksGate({ current_status: ItemStatus.InTest, is_finished: false, step_type_id: gate }, gate), false);
  assert.equal(blocksGate({ current_status: ItemStatus.Done, is_finished: true, step_type_id: 3 }, gate), false);
  assert.equal(blocksGate({ current_status: null, is_finished: null, step_type_id: null }, gate), false);
  assert.equal(blocksGate({ current_status: ItemStatus.Queued, is_finished: false, step_type_id: 3 }, gate), true);
  assert.equal(blocksGate({ current_status: ItemStatus.AwaitResearch, is_finished: false, step_type_id: gate }, gate), true);
});

test("itemState: missing by the closing decision, done, in test, new before the box opened, else waiting", () => {
  const box = { current_route_step: 1, is_finished: false };
  assert.equal(itemState(at(2, ItemStatus.Queued), box, { item_id: "1", decision: "missing", note: null }), "missing");
  assert.equal(itemState(at(3, ItemStatus.Done), box, undefined), "done");
  assert.equal(itemState(at(2, ItemStatus.InResearch), box, undefined), "test");
  assert.equal(itemState(at(1, ItemStatus.Queued), box, undefined), "new");
  assert.equal(itemState(at(1, ItemStatus.Queued), { current_route_step: 2, is_finished: false }, undefined), "queue");
});

test("itemWhereText: the station while worked on, research wait, the next step's type, nothing when done", () => {
  const where = (status: number, station: string | null, step: string | null) =>
    itemWhereText({ ...at(2, status), station_name: station, step_type_desc: step });
  assert.equal(where(ItemStatus.InTest, "  עמדה 3 ", "בדיקה"), "עמדה 3");
  assert.equal(where(ItemStatus.AwaitResearch, null, "בדיקה"), "ממתין למחקר");
  assert.equal(where(ItemStatus.Queued, null, "בדיקה "), "ממתין לבדיקה");
  assert.equal(where(ItemStatus.Done, "עמדה", "בדיקה"), null);
});

test("packageStatus: pending without a route, then by the route row and the blockers", () => {
  const box = (step: number, status: number, routed = true, finished = false) => ({ ...at(step, status, finished), routed });
  assert.equal(packageStatus(box(1, ItemStatus.Queued, false), 0), "pending");
  assert.equal(packageStatus(box(3, ItemStatus.Done, true, true), 0), "done");
  assert.equal(packageStatus(box(1, ItemStatus.InTest), 0), "test");
  assert.equal(packageStatus(box(3, ItemStatus.AwaitPackageItems), 0), "waitItems");
  assert.equal(packageStatus(box(1, ItemStatus.Queued), 0), "queue");
  assert.equal(packageStatus(box(3, ItemStatus.Queued), 0), "readyClose");
  assert.equal(packageStatus(box(3, ItemStatus.Queued), 2), "waitItems");
});

test("arrivedAtClosing: at the route's last step after the first, waiting or in test there", () => {
  const m = (step: number, status: number, type: number, last: number) => ({ ...at(step, status), step_type_id: type, last_step_type_id: last });
  assert.ok(arrivedAtClosing(m(3, ItemStatus.Queued, 9, 9)));
  assert.ok(!arrivedAtClosing(m(2, ItemStatus.Queued, 5, 9)));
  assert.ok(!arrivedAtClosing(m(3, ItemStatus.AwaitResearch, 9, 9)));
});

test("decisionsOf: the closing step's decisions; anything else reads as none", () => {
  assert.deepEqual(decisionsOf({ decisions: [{ item_id: 5, decision: "packed" }, { nope: 1 }] }), [{ item_id: "5", decision: "packed", note: null }]);
  assert.deepEqual(decisionsOf(null), []);
  assert.deepEqual(decisionsOf({ decisions: "x" }), []);
});

const view = (o: Partial<PackageView>): PackageView => ({
  item_id: "323011126000100", item_type_desc: "ערכה", makat: "MK-1", shipment_code: "SH-1", customer_name: "לקוח",
  current_route_step: 1, is_finished: false, status: "queue", blocked_by: [], items: [], ...o,
} as PackageView);

test("packageMatches: the box's own fields or an item's id, serial or makat, case-blind", () => {
  const v = view({ items: [{ item_id: "323011126000101", serial_no: "Ab-12", makat: "X9" } as PackageView["items"][number]] });
  assert.ok(packageMatches(v, "sh-1"));
  assert.ok(packageMatches(v, " ab-12 "));
  assert.ok(packageMatches(v, "000101"));
  assert.ok(!packageMatches(v, "zzz"));
});

test("isAtOpening / waitsForItems / isPackageStatusKey", () => {
  assert.ok(isAtOpening(view({ status: "test" })));
  assert.ok(!isAtOpening(view({ status: "readyClose", current_route_step: 3 })));
  assert.ok(waitsForItems(view({ status: "waitItems", blocked_by: [{ item_id: "1", package_seq: 1, item_type_desc: "x", station_name: null }] })));
  assert.ok(!waitsForItems(view({ status: "waitItems" })));
  assert.ok(isPackageStatusKey("readyClose"));
  assert.ok(!isPackageStatusKey("closed"));
});

test("templateSeqRanges: each line takes max(1, quantity) positions, in order", () => {
  assert.deepEqual(
    templateSeqRanges([{ quantity: 2 }, { quantity: 0 }, { quantity: 3 }]).map((l) => [l.seq_from, l.seq_to]),
    [[1, 2], [3, 3], [4, 6]],
  );
});

test("parseDefaultRoute: blank is none, a whole number from 1, anything else the given words", () => {
  assert.deepEqual(parseDefaultRoute(""), { value: null });
  assert.deepEqual(parseDefaultRoute(" 2 "), { value: 2 });
  assert.ok("error" in parseDefaultRoute(0));
  assert.deepEqual(parseDefaultRoute("1.5", "מילים"), { error: "מילים" });
});

test("readItemInput: type and serial required; the rest optional, trimmed", () => {
  assert.equal(readItemInput({ itemType: 4 }), null);
  assert.equal(readItemInput({ serialNumber: "S1" }), null);
  assert.equal(readItemInput({ itemType: 1.5, serialNumber: "S1" }), null);
  assert.deepEqual(readItemInput({ itemType: "4", serialNumber: " S1 ", makat: 7, routeNumber: "x" }), {
    itemType: 4, serialNumber: "S1", makat: "7", model: "", manufacturer: "", manufacturerNo: null, routeNumber: null,
  });
});
