import { test } from "node:test";
import assert from "node:assert/strict";
import { netSecondsBetween } from "../work-clock";

// Two working windows, in ms: [0, 10s) and [20s, 30s).
const W = [0, 10_000, 20_000, 30_000];

test("net time counts only the parts inside working windows", () => {
  assert.equal(netSecondsBetween(W, 5_000, 25_000), 10); // 5s of the first + 5s of the second
  assert.equal(netSecondsBetween(W, -50_000, 50_000), 20); // both whole windows
  assert.equal(netSecondsBetween(W, 2_000, 4_000), 2); // inside one window
});

test("a span that falls between windows is zero — the clock stands still off hours", () => {
  assert.equal(netSecondsBetween(W, 12_000, 18_000), 0);
  assert.equal(netSecondsBetween(W, 10_000, 20_000), 0); // windows are [start, end)
  assert.equal(netSecondsBetween(W, 40_000, 90_000), 0);
});

test("an empty or reversed span, or no windows, is zero", () => {
  assert.equal(netSecondsBetween(W, 25_000, 5_000), 0);
  assert.equal(netSecondsBetween(W, 7_000, 7_000), 0);
  assert.equal(netSecondsBetween([], 0, 100_000), 0);
});
