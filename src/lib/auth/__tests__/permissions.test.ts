// can(): a permission is granted by its perm-… role and taken away by its no-… role; a token
// without any perm-… role (a realm the migration script has not run on, dev mode, tests) answers
// by the main role's default bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import table from "../permissions.json";
import { ACCESS, APP_ROLES, PERMISSIONS, can, isPermissionKey, permissionOfRole } from "../roles";

test("every permission has a perm-… and a no-… role, all names distinct", () => {
  const names = PERMISSIONS.flatMap((p) => [p.role, p.deny]);
  assert.equal(new Set(names).size, names.length);
  for (const p of PERMISSIONS) {
    assert.match(p.role, /^perm-[a-z-]+$/);
    assert.equal(p.deny, `no-${p.role.slice("perm-".length)}`);
    for (const r of p.bundles) assert.ok(APP_ROLES.includes(r), `${p.key}: ${r}`);
  }
  assert.equal(ACCESS.stepBack.role, "perm-step-back");
  assert.equal(ACCESS.stepBack.deny, "no-step-back");
});

test("the main roles are the table's, in its order", () => {
  assert.deepEqual(APP_ROLES, ["manager", "tester", "storekeeper", "mashan"]);
  assert.deepEqual(Object.keys(table.mainRoles), APP_ROLES);
});

test("a migrated token: the perm-… role grants, the main role alone does not", () => {
  assert.equal(can(["tester", "perm-step-back", "perm-testing"], ACCESS.stepBack), true);
  // Keycloak's bundle for this tester has no step-back: the main role does not bring it back.
  assert.equal(can(["tester", "perm-testing"], ACCESS.stepBack), false);
  // A permission given to one user directly, outside the bundle.
  assert.equal(can(["storekeeper", "perm-shipments", "perm-work-hours"], ACCESS.workHours), true);
});

test("no-… takes a permission away even though the bundle holds it", () => {
  assert.equal(can(["tester", "perm-step-back", "perm-testing", "no-step-back"], ACCESS.stepBack), false);
  assert.equal(can(["tester", "perm-step-back", "perm-testing", "no-step-back"], ACCESS.testing), true);
});

test("a token without any perm-… role answers by the default bundle — and no-… still takes away", () => {
  assert.equal(can(["tester"], ACCESS.stepBack), true);
  assert.equal(can(["tester"], ACCESS.dashboard), false);
  assert.equal(can(["manager"], ACCESS.usersAdmin), true);
  assert.equal(can(["tester", "no-step-back"], ACCESS.stepBack), false);
  assert.equal(can([], ACCESS.files), false);
  assert.equal(can(null, ACCESS.files), false);
});

test("the report template is the station fields' permission; keys and role names map back", () => {
  assert.equal(ACCESS.reportTemplate, ACCESS.fieldsEdit);
  assert.equal(permissionOfRole("no-step-back"), ACCESS.stepBack);
  assert.equal(permissionOfRole("perm-files"), ACCESS.files);
  assert.equal(permissionOfRole("manager"), undefined);
  assert.equal(isPermissionKey("stepBack"), true);
  assert.equal(isPermissionKey("toString"), false);
});
