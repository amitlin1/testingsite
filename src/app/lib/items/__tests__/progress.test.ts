// How far along its route an item row is, as /items and its edit dialog show it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemProgress } from "../progress";

const row = (o: Partial<Parameters<typeof itemProgress>[0]>) => ({
  current_status: 2, is_finished: false, current_route_step: 1, total_steps: 4, ...o,
});

test("itemProgress: the step out of the route's steps", () => {
  assert.deepEqual(itemProgress(row({ current_route_step: 2 })), { inBox: false, pct: 50, text: "2/4" });
  assert.deepEqual(itemProgress(row({ current_route_step: null })), { inBox: false, pct: 0, text: "0/4" });
});

test("itemProgress: a done item is full, with or without a route", () => {
  assert.deepEqual(itemProgress(row({ current_status: 3, current_route_step: 2 })), { inBox: false, pct: 100, text: "4/4" });
  assert.deepEqual(itemProgress(row({ is_finished: true, total_steps: 0 })), { inBox: false, pct: 100, text: "הושלם" });
});

test("itemProgress: no route, nothing to show; an item in a box shows none of its own", () => {
  assert.deepEqual(itemProgress(row({ total_steps: null })), { inBox: false, pct: 0, text: "—" });
  assert.deepEqual(itemProgress(row({ package_id: 323011126000100 })), { inBox: true, pct: 0, text: "—" });
  assert.equal(itemProgress(row({ package_id: null })).inBox, false);
});

test("itemProgress: a step past the route's end never draws past full", () => {
  assert.equal(itemProgress(row({ current_route_step: 6 })).pct, 100);
});
