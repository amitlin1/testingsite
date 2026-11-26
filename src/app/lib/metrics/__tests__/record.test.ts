// The ledger's event_key bytes, for every key shape the write paths record. They are a contract
// beyond this code: keys already stored must keep matching a retry of the same action, and
// scripts/dev/seed-dev-dataset.mjs reads the action id back out of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventKeyOf, type EventKeyParts } from "../ledger/record";
import type { MetricsReason } from "../vocabulary";

const A = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const key = (reason: MetricsReason, k: EventKeyParts, seq?: number) => eventKeyOf({ reason, itemId: BigInt("2611250010001234"), key: k, seq });

test("an action alone: a start or a release", () => {
  assert.equal(key("test_started", { actionId: A }), `test_started:${A}`);
  assert.equal(key("released_by_user", { actionId: A }), `released_by_user:${A}`);
});

test("an action and its item: a box's group, a package reset, a research note", () => {
  assert.equal(key("test_started", { actionId: A, item: true }), `test_started:${A}:2611250010001234`);
  assert.equal(key("released_by_user", { actionId: A, item: true }), `released_by_user:${A}:2611250010001234`);
  assert.equal(key("package_reset", { actionId: A, item: true }), `package_reset:${A}:2611250010001234`);
  assert.equal(key("research_note", { actionId: A, item: true }, 0), `research_note:${A}:2611250010001234`);
});

test("an action, its item and the seq: every event of a result submit", () => {
  assert.equal(key("result_submitted", { actionId: A, item: true, seq: true }, 0), `result_submitted:${A}:2611250010001234:0`);
  assert.equal(key("station_reassigned", { actionId: A, item: true, seq: true }, 3), `station_reassigned:${A}:2611250010001234:3`);
  assert.equal(key("no_station_for_type", { actionId: A, item: true, seq: true }), `no_station_for_type:${A}:2611250010001234:0`);
});

test("a name of its own: a step back", () => {
  assert.equal(key("manual_override", { name: "step_back", actionId: A, item: true }), `step_back:${A}:2611250010001234`);
});

test("the item alone: the item enters its route", () => {
  assert.equal(key("item_created", { item: true }), "item_created:2611250010001234");
});

test("the item and a fresh uuid: an action with no id of its own", () => {
  assert.match(key("manual_override", { name: "retype", item: true, unique: true }), new RegExp(`^retype:2611250010001234:${UUID}$`));
  assert.match(key("package_items_ready", { item: true, unique: true }), new RegExp(`^package_items_ready:2611250010001234:${UUID}$`));
  assert.match(key("package_items_pending", { item: true, unique: true }), new RegExp(`^package_items_pending:2611250010001234:${UUID}$`));
  assert.notEqual(key("package_items_ready", { item: true, unique: true }), key("package_items_ready", { item: true, unique: true }));
});
