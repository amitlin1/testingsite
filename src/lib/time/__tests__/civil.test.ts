import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  businessDay,
  dayCountInclusive,
  dayDiff,
  eachDate,
  isCivilDate,
  localCivilDate,
  monthEnd,
  monthStart,
  startOfBusinessDay,
  weekdayOf,
} from "../civil";

const HOUR_MS = 3_600_000;

test("isCivilDate accepts only well-formed dates that exist", () => {
  assert.equal(isCivilDate("2026-09-17"), true);
  assert.equal(isCivilDate("2028-02-29"), true);
  assert.equal(isCivilDate("2026-02-29"), false);
  assert.equal(isCivilDate("2026-02-31"), false);
  assert.equal(isCivilDate("2026-13-01"), false);
  assert.equal(isCivilDate("2026-9-1"), false); // must be zero-padded
  assert.equal(isCivilDate("not-a-date"), false);
  assert.equal(isCivilDate(null), false);
});

test("weekdayOf: 0 = Sunday … 6 = Saturday", () => {
  assert.equal(weekdayOf("2026-09-12"), 6); // Rosh Hashana 2026 — Saturday
  assert.equal(weekdayOf("2026-04-22"), 3); // Yom HaAtzmaut 2026 — Wednesday
  assert.equal(weekdayOf("2026-09-25"), 5); // Erev Sukkot 2026 — Friday
  assert.equal(weekdayOf("2026-03-29"), 0); // the Sunday after the spring clock change
});

test("localCivilDate reads a Date's local calendar day", () => {
  assert.equal(localCivilDate(new Date(2026, 8, 5)), "2026-09-05");
  assert.equal(localCivilDate(new Date(2026, 0, 1, 23, 59)), "2026-01-01");
});

test("addDays crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(addDays("2026-03-27", 1), "2026-03-28"); // across the spring clock change
  assert.equal(addDays("2026-10-25", 1), "2026-10-26"); // across the autumn clock change
});

test("addMonths clamps the day to the target month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2026-05-31", 1), "2026-06-30");
  assert.equal(addMonths("2026-11-24", 12), "2027-11-24");
  assert.equal(addMonths("2026-11-24", -24), "2024-11-24");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
});

test("dayDiff is signed and exclusive; dayCountInclusive counts both ends", () => {
  assert.equal(dayDiff("2026-08-03", "2026-08-03"), 0);
  assert.equal(dayDiff("2026-08-03", "2026-08-04"), 1);
  assert.equal(dayDiff("2026-08-04", "2026-08-03"), -1);
  assert.equal(dayDiff("2026-01-01", "2026-12-31"), 364);
  assert.equal(dayDiff("2026-03-26", "2026-03-28"), 2); // a 23-hour day in between
  assert.equal(dayCountInclusive("2026-08-03", "2026-08-03"), 1);
  assert.equal(dayCountInclusive("2026-01-01", "2026-12-31"), 365);
  assert.equal(dayCountInclusive("2028-01-01", "2028-12-31"), 366);
});

test("eachDate lists [from, to] ascending, both ends included", () => {
  assert.deepEqual(eachDate("2026-09-30", "2026-10-02"), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(eachDate("2026-10-24", "2026-10-26"), ["2026-10-24", "2026-10-25", "2026-10-26"]);
  assert.equal(eachDate("2026-01-01", "2026-12-31").length, 365);
  assert.deepEqual(eachDate("2026-09-02", "2026-09-01"), []);
});

test("monthStart / monthEnd give the month's real first and last day", () => {
  assert.equal(monthStart(2026, 8), "2026-09-01");
  assert.equal(monthEnd(2026, 8), "2026-09-30");
  assert.equal(monthEnd(2026, 1), "2026-02-28");
  assert.equal(monthEnd(2028, 1), "2028-02-29");
  assert.equal(monthEnd(2100, 1), "2100-02-28"); // divisible by 100, not by 400
  assert.equal(monthEnd(2026, 11), "2026-12-31");
  for (let m = 0; m < 12; m++) assert.equal(isCivilDate(monthEnd(2026, m)), true);
});

test("the 2026 spring change: 2026-03-27 is a 23-hour business day starting at local midnight", () => {
  const start = startOfBusinessDay("2026-03-27");
  const next = startOfBusinessDay("2026-03-28");
  assert.equal(start.toISOString(), "2026-03-26T22:00:00.000Z"); // 00:00 at +02:00
  assert.equal(next.toISOString(), "2026-03-27T21:00:00.000Z"); // 00:00 at +03:00
  assert.equal(next.getTime() - start.getTime(), 23 * HOUR_MS);
  assert.equal(businessDay(start), "2026-03-27");
  assert.equal(businessDay(start.getTime() - 1), "2026-03-26");
  assert.equal(businessDay(next.getTime() - 1), "2026-03-27");
});

test("the 2026 autumn change: 2026-10-25 is a 25-hour business day starting at local midnight", () => {
  const start = startOfBusinessDay("2026-10-25");
  const next = startOfBusinessDay("2026-10-26");
  assert.equal(start.toISOString(), "2026-10-24T21:00:00.000Z"); // 00:00 at +03:00
  assert.equal(next.toISOString(), "2026-10-25T22:00:00.000Z"); // 00:00 at +02:00
  assert.equal(next.getTime() - start.getTime(), 25 * HOUR_MS);
  assert.equal(businessDay(start), "2026-10-25");
  assert.equal(businessDay(start.getTime() - 1), "2026-10-24");
  assert.equal(businessDay(next.getTime() - 1), "2026-10-25");
});
