import { test } from "node:test";
import assert from "node:assert/strict";
import { packageRolesByType, roleAtStep, soleRole } from "../placement";

test("a package route's last step closes the box, every other opens it", () => {
  assert.equal(roleAtStep(0, 2), "opening");
  assert.equal(roleAtStep(1, 2), "closing");
  assert.equal(roleAtStep(1, 3), "opening");
  assert.equal(roleAtStep(0, 1), "opening", "a lone step opens");
});

test("roles by station type, over the package types' routes only", () => {
  const routes = [
    { item_type_id: 15, route_steps: [5, 8] },
    { item_type_id: 16, route_steps: [5, 8] },
    { item_type_id: 17, route_steps: [5, 9, 5] }, // type 5 also closes here
    { item_type_id: 3, route_steps: [2, 8] },     // an item type's route: not counted
  ];
  const roles = packageRolesByType(routes, (id) => id >= 15);
  assert.deepEqual([...roles.get(8)!], ["closing"]);
  assert.deepEqual([...roles.get(9)!], ["opening"]);
  assert.deepEqual([...roles.get(5)!].sort(), ["closing", "opening"]);
  assert.equal(roles.has(2), false);
  assert.equal(soleRole(roles.get(8)), "closing");
  assert.equal(soleRole(roles.get(5)), null, "both roles: none is sole");
  assert.equal(soleRole(undefined), null);
});
