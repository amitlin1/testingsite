import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toMinutes,
  fromMinutes,
  netMinutes,
  formatNet,
  isEndBeforeStart,
  isValidTime,
  isValidDate,
  weekdayOf,
  toDateString,
  eachDate,
  isDateInRange,
  addDays,
  daysBetween,
  monthStartISO,
  monthEndISO,
} from "../time";

test("toMinutes / fromMinutes", () => {
  assert.equal(toMinutes("07:00"), 420);
  assert.equal(toMinutes("15:35"), 935);
  assert.equal(toMinutes(null), 0);
  assert.equal(toMinutes("bad"), 0);
  assert.equal(fromMinutes(455), "07:35");
  assert.equal(fromMinutes(0), "00:00");
});

test("netMinutes: default day is 7h35m, half day is 5h", () => {
  assert.equal(netMinutes("07:00", "15:35", "12:00", "13:00"), 455);
  assert.equal(netMinutes("07:00", "12:00", null, null), 300);
  assert.equal(netMinutes(null, "15:35", null, null), 0);
  assert.equal(netMinutes("15:00", "07:00", null, null), 0); // never negative
  // A malformed break is ignored rather than making the day longer/negative.
  assert.equal(netMinutes("07:00", "15:35", "13:00", "12:00"), 515);
});

test("formatNet", () => {
  assert.equal(formatNet(455), "7h 35m");
  assert.equal(formatNet(300), "5h 00m");
  assert.equal(formatNet(0), "0h 00m");
  assert.equal(formatNet(-10), "0h 00m");
});

test("isEndBeforeStart", () => {
  assert.equal(isEndBeforeStart("07:00", "06:30"), true);
  assert.equal(isEndBeforeStart("07:00", "07:00"), true); // not strictly after
  assert.equal(isEndBeforeStart("07:00", "07:01"), false);
});

test("isValidTime", () => {
  assert.equal(isValidTime("07:00"), true);
  assert.equal(isValidTime("23:59"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("7:00"), true);
  assert.equal(isValidTime("07:60"), false);
  assert.equal(isValidTime(null), false);
});

test("isValidDate rejects impossible dates", () => {
  assert.equal(isValidDate("2026-09-17"), true);
  assert.equal(isValidDate("2026-02-31"), false);
  assert.equal(isValidDate("2026-13-01"), false);
  assert.equal(isValidDate("2026-9-1"), false); // must be zero-padded
  assert.equal(isValidDate("not-a-date"), false);
});

test("weekdayOf uses local components (0=Sun … 6=Sat)", () => {
  assert.equal(weekdayOf("2026-09-12"), 6); // Rosh Hashana 2026 — Saturday
  assert.equal(weekdayOf("2026-04-22"), 3); // Yom HaAtzmaut 2026 — Wednesday
  assert.equal(weekdayOf("2026-09-25"), 5); // Erev Sukkot 2026 — Friday
});

test("toDateString / eachDate / isDateInRange", () => {
  assert.equal(toDateString(new Date(2026, 8, 5)), "2026-09-05");
  assert.deepEqual(eachDate("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.equal(eachDate("2026-01-01", "2026-12-31").length, 365);
  assert.equal(isDateInRange("2026-09-27", "2026-09-27", "2026-09-28"), true);
  assert.equal(isDateInRange("2026-09-26", "2026-09-27", "2026-09-28"), false);
});

test("addDays crosses month/year boundaries without a UTC shift", () => {
  assert.equal(addDays("2026-08-03", 1), "2026-08-04");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29"); // leap year
});

test("daysBetween", () => {
  assert.equal(daysBetween("2026-08-03", "2026-08-03"), 0);
  assert.equal(daysBetween("2026-08-03", "2026-08-04"), 1);
  assert.equal(daysBetween("2026-01-01", "2026-12-31"), 364);
  assert.equal(daysBetween("2026-08-04", "2026-08-03"), -1);
});

test("monthStartISO / monthEndISO give a REAL last day", () => {
  assert.equal(monthStartISO(2026, 8), "2026-09-01");
  // The bug this replaced: a hard-coded "-31" in 30-day months and February.
  assert.equal(monthEndISO(2026, 8), "2026-09-30");
  assert.equal(monthEndISO(2026, 1), "2026-02-28");
  assert.equal(monthEndISO(2028, 1), "2028-02-29"); // leap year
  assert.equal(monthEndISO(2026, 11), "2026-12-31");
  // Every month of a year must round-trip through isValidDate.
  for (let m = 0; m < 12; m++) assert.equal(isValidDate(monthEndISO(2026, m)), true);
});
