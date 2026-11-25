// Which popup a station opens for a queue row (the testing screen's dispatch).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PackageView } from "@/app/lib/packages/contract";
import { CODE_POPUPS } from "@/app/lib/popup-templates/codePopups";
import { ItemStatus } from "@/lib/item-status";
import { codePopupKindOf, opensOnStart, packageRoleOf, stationPopupOf } from "../popup-kind";

const PKG = { items: [] } as unknown as PackageView;
const codeTypeId = Number(Object.keys(CODE_POPUPS)[0]);
const plainTypeId = 99_999;

test("a box at a package-level station: its wizard by its place on the route, its template when the type has a package one", () => {
  const type = { id: 50, name: "t", packageLevel: true, popupTemplate: null };
  const box = { is_package: true, package: PKG, current_status: ItemStatus.Queued, route_steps: [50, 60, 50], current_route_step: 1 };
  assert.deepEqual(stationPopupOf(type, box), { kind: "package", role: "opening", template: false });
  assert.deepEqual(stationPopupOf(type, { ...box, current_route_step: 3 }), { kind: "package", role: "closing", template: false });
  assert.deepEqual(stationPopupOf({ ...type, popupTemplate: { base: "package", version: 1 } }, box), { kind: "package", role: "opening", template: true });
  assert.deepEqual(stationPopupOf({ ...type, popupTemplate: { base: "item", version: 1 } }, box).kind, "package");
  // A one-step route only opens.
  assert.equal(packageRoleOf({ route_steps: [50], current_route_step: 1 }), "opening");
});

test("anything else: the type's template, except for an item in research, which keeps the code's popup", () => {
  const type = { id: codeTypeId, name: "t", popupTemplate: { base: "item", version: 2 } };
  const item = { is_package: false, package: null, current_status: ItemStatus.InTest, route_steps: [1], current_route_step: 1 };
  assert.deepEqual(stationPopupOf(type, item), { kind: "item", typeId: codeTypeId, template: true });
  assert.deepEqual(stationPopupOf(type, { ...item, current_status: ItemStatus.InResearch }), { kind: "item", typeId: codeTypeId, template: false });
  // A box row at an item-level station is an item here.
  assert.equal(stationPopupOf({ id: plainTypeId, name: "t" }, { ...item, is_package: true, package: PKG }).kind, "item");
});

test("the start opens a popup only for a type with a template or a code popup of its own", () => {
  assert.equal(opensOnStart({ id: codeTypeId, name: "t" }), true);
  assert.equal(opensOnStart({ id: plainTypeId, name: "t", popupTemplate: { base: "item", version: 1 } }), true);
  assert.equal(opensOnStart({ id: plainTypeId, name: "t", popupTemplate: null }), false);
  // Without a code popup of its own a type gets the plain report dialog; with one, never.
  assert.equal(codePopupKindOf(plainTypeId), "dialog");
  for (const id of Object.keys(CODE_POPUPS).map(Number)) assert.notEqual(codePopupKindOf(id), "dialog");
});
