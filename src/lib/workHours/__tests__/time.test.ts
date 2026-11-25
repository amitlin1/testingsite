import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exceedsHalfDayCap,
  formatNet,
  isEndBeforeStart,
  isValidTime,
  netMinutes,
  toMinutes,
  workingWindows,
} from "../time";

test("toMinutes", () => {
  assert.equal(toMinutes("07:00"), 420);
  assert.equal(toMinutes("15:35"), 935);
  assert.equal(toMinutes(null), 0);
  assert.equal(toMinutes("bad"), 0);
});

test("workingWindows: a break inside the day splits it in two", () => {
  assert.deepEqual(workingWindows("07:00", "15:35", "12:00", "13:00"), [
    ["07:00", "12:00"],
    ["13:00", "15:35"],
  ]);
  assert.deepEqual(workingWindows("07:00", "12:00", null, null), [["07:00", "12:00"]]);
});

test("workingWindows: no window without hours or when the day ends before it starts", () => {
  assert.deepEqual(workingWindows(null, "15:35", null, null), []);
  assert.deepEqual(workingWindows("15:00", "07:00", null, null), []);
  assert.deepEqual(workingWindows("07:00", "07:00", null, null), []);
});

test("workingWindows: a break touching an edge leaves no zero-length window", () => {
  assert.deepEqual(workingWindows("07:00", "15:35", "07:00", "08:00"), [["08:00", "15:35"]]);
  assert.deepEqual(workingWindows("07:00", "15:35", "15:00", "15:35"), [["07:00", "15:00"]]);
});

test("workingWindows: a break that is not a real interval inside the day is ignored", () => {
  const whole = [["07:00", "15:35"]];
  assert.deepEqual(workingWindows("07:00", "15:35", "13:00", "12:00"), whole); // reversed
  assert.deepEqual(workingWindows("07:00", "15:35", "12:00", null), whole); // one-sided
  assert.deepEqual(workingWindows("07:00", "15:35", "06:00", "07:30"), whole); // starts before the day
  assert.deepEqual(workingWindows("07:00", "15:35", "15:00", "16:00"), whole); // ends after the day
});

test("netMinutes: default day is 7h35m, half day is 5h", () => {
  assert.equal(netMinutes("07:00", "15:35", "12:00", "13:00"), 455);
  assert.equal(netMinutes("07:00", "12:00", null, null), 300);
  assert.equal(netMinutes(null, "15:35", null, null), 0);
  assert.equal(netMinutes("15:00", "07:00", null, null), 0);
  assert.equal(netMinutes("07:00", "15:35", "13:00", "12:00"), 515);
});

test("netMinutes counts what the ledger counts: a break outside the hours is not subtracted", () => {
  // The settings figure used to subtract it (120) while work_span ignored it (180).
  assert.equal(netMinutes("07:00", "10:00", "12:00", "13:00"), 180);
  assert.equal(netMinutes("07:00", "12:30", "12:00", "13:00"), 330);
});

test("formatNet", () => {
  assert.equal(formatNet(455), "7h 35m");
  assert.equal(formatNet(300), "5h 00m");
  assert.equal(formatNet(0), "0h 00m");
  assert.equal(formatNet(-10), "0h 00m");
});

test("isEndBeforeStart: end must be strictly after start", () => {
  assert.equal(isEndBeforeStart("07:00", "06:30"), true);
  assert.equal(isEndBeforeStart("07:00", "07:00"), true);
  assert.equal(isEndBeforeStart("07:00", "07:01"), false);
});

test("exceedsHalfDayCap: a half day may end at 12:00, not after", () => {
  assert.equal(exceedsHalfDayCap("12:00"), false);
  assert.equal(exceedsHalfDayCap("11:30"), false);
  assert.equal(exceedsHalfDayCap("12:01"), true);
});

test("isValidTime", () => {
  assert.equal(isValidTime("07:00"), true);
  assert.equal(isValidTime("23:59"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("7:00"), true);
  assert.equal(isValidTime("07:60"), false);
  assert.equal(isValidTime(null), false);
});
