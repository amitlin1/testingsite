// The user-administration rules the users API enforces.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanName,
  employeeNumberEdit,
  fullNameOf,
  isSameAccount,
  parseDenied,
  isServiceAccount,
  isUserId,
  parseNewUser,
} from "../rules";

const valid = { username: "dana.c", temporaryPassword: "Abc123", role: "tester" };

test("a new user: the fields as stored, the forced password change on unless explicitly off", () => {
  assert.deepEqual(parseNewUser({ ...valid, username: "  dana.c ", firstName: "  דנה ", lastName: "x".repeat(150), employeeNumber: " 1234 " }), {
    username: "dana.c",
    firstName: "דנה",
    lastName: "x".repeat(100),
    employeeNumber: "1234",
    role: "tester",
    temporaryPassword: "Abc123",
    mustChangePassword: true,
  });
  assert.equal(parseNewUser({ ...valid, mustChangePassword: false })?.mustChangePassword, false);
  assert.equal(parseNewUser({ ...valid, employeeNumber: "" })?.employeeNumber, undefined);
});

test("a new user breaking a rule is refused", () => {
  assert.equal(parseNewUser(null), null);
  assert.equal(parseNewUser({ ...valid, username: "ab" }), null);
  assert.equal(parseNewUser({ ...valid, username: "דנה" }), null);
  assert.equal(parseNewUser({ ...valid, temporaryPassword: "12345" }), null);
  assert.equal(parseNewUser({ ...valid, role: "admin" }), null);
  assert.equal(parseNewUser({ ...valid, employeeNumber: "12a" }), null);
});

test("an edit's employee number: absent leaves it, empty clears it, else trimmed to 32", () => {
  assert.equal(employeeNumberEdit(undefined), undefined);
  assert.equal(employeeNumberEdit(""), null);
  assert.equal(employeeNumberEdit(null), null);
  assert.equal(employeeNumberEdit(" 42 "), "42");
  assert.equal(employeeNumberEdit("9".repeat(40)), "9".repeat(32));
  assert.equal(cleanName(7), undefined);
});

test("ids, service accounts, the signed-in account, the shown name", () => {
  assert.equal(isUserId("3f2b8c1e-0d4a-4c8e-9b1a-2e3f4a5b6c7d"), true);
  assert.equal(isUserId("not-a-uuid"), false);
  assert.equal(isServiceAccount("service-account-testing-admin-api"), true);
  assert.equal(isServiceAccount("dana"), false);
  assert.equal(isSameAccount("dana", "dana"), true);
  assert.equal(isSameAccount("", ""), false);
  assert.equal(isSameAccount("dana", undefined), false);
  assert.equal(fullNameOf({ username: "dana", firstName: "דנה", lastName: "כהן" }), "דנה כהן");
  assert.equal(fullNameOf({ username: "dana", firstName: "", lastName: "כהן" }), "כהן");
  assert.equal(fullNameOf({ username: "dana" }), "dana");
});

test("parseDenied: a list of permission keys, each once; never user management; anything else refused", () => {
  assert.deepEqual(parseDenied({ denied: [] }), []);
  assert.deepEqual(parseDenied({ denied: ["stepBack", "files", "stepBack"] }), ["stepBack", "files"]);
  assert.equal(parseDenied({ denied: ["usersAdmin"] }), null);
  assert.equal(parseDenied({ denied: ["no-step-back"] }), null);
  assert.equal(parseDenied({ denied: "stepBack" }), null);
  assert.equal(parseDenied({}), null);
  assert.equal(parseDenied(null), null);
});
