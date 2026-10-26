import { test } from "node:test";
import assert from "node:assert/strict";
import { kitTypeOptions, routeForKitType, routeNumberOptions } from "../routePickModel";
import type { ItemTypeRow, RouteRow } from "../routePickModel";
import { kitRoutesText, routeNumberSubText } from "../labels";

const TYPES: ItemTypeRow[] = [
  { id: 1, label: "מחשב ", isPackage: false, defaultRoute: null },
  { id: 10, label: "מארז עמדת עבודה", isPackage: true, defaultRoute: 2 },
  { id: 11, label: "מארז ציוד היקפי ", isPackage: true, defaultRoute: null },
  { id: 12, label: "מארז ריק", isPackage: true, defaultRoute: null },
];

const ROUTES: RouteRow[] = [
  { item_type_id: 1, route_number: 1, route_steps: [5, 6, 7] },
  { item_type_id: 10, route_number: 1, route_steps: [5, 7] },
  { item_type_id: 10, route_number: 2, route_steps: [5, 6, 6, 7] },
  { item_type_id: 11, route_number: 3, route_steps: [5, 7] },
];

test("the package types only, by name, each with its route count", () => {
  assert.deepEqual(kitTypeOptions(TYPES, ROUTES), [
    { id: 10, label: "מארז עמדת עבודה", routeCount: 2 },
    { id: 11, label: "מארז ציוד היקפי", routeCount: 1 },
    { id: 12, label: "מארז ריק", routeCount: 0 },
  ]);
});

test("route numbers: the existing ones in order, then the next free one", () => {
  assert.deepEqual(routeNumberOptions(10, ROUTES, 2, 2), [
    { route: 1, stations: 2, isDefault: false, isNew: false },
    { route: 2, stations: 4, isDefault: true, isNew: false },
    { route: 3, stations: 0, isDefault: false, isNew: true },
  ]);
});

test("route numbers: the number open now is the new one when it has no route", () => {
  const opts = routeNumberOptions(10, ROUTES, 2, 7);
  assert.deepEqual(opts.map((o) => [o.route, o.isNew]), [[1, false], [2, false], [7, true]], "one new number, never two");
  assert.deepEqual(routeNumberOptions(11, ROUTES, null, 1).map((o) => [o.route, o.isNew]), [[1, true], [3, false]], "sorted by number");
});

test("route numbers: a kit without routes offers its default number", () => {
  assert.deepEqual(routeNumberOptions(12, ROUTES, null, null), [{ route: 1, stations: 0, isDefault: true, isNew: true }]);
  assert.deepEqual(routeNumberOptions(12, ROUTES, 4, null).map((o) => o.route), [4]);
});

test("picking a package type opens its default route, else its lowest, else a new default", () => {
  assert.equal(routeForKitType(10, ROUTES, 2), 2);
  assert.equal(routeForKitType(10, ROUTES, 9), 1, "a default without a route: the lowest");
  assert.equal(routeForKitType(11, ROUTES, null), 3);
  assert.equal(routeForKitType(12, ROUTES, null), 1);
  assert.equal(routeForKitType(12, ROUTES, 4), 4);
});

test("the pickers' subtitles", () => {
  assert.equal(kitRoutesText(0), "אין מסלול עדיין");
  assert.equal(kitRoutesText(1), "מסלול אחד");
  assert.equal(kitRoutesText(3), "3 מסלולים");
  assert.equal(routeNumberSubText(4, false), "4 עמדות");
  assert.equal(routeNumberSubText(1, true), "עמדה אחת · ברירת מחדל");
  assert.equal(routeNumberSubText(0, false), "ללא עמדות");
});
