import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { UI_MONTH_CAP } from "@/app/lib/dashboard/contract";
import { addDays, addMonths, dayCountInclusive } from "@/lib/time/civil";
import { PeriodError, resolvePeriod, toBusinessDay } from "../period";

// A fixed clock: 12:00 in Asia/Jerusalem on 2026-08-28.
const NOW = new Date("2026-08-28T09:00:00Z");
const TODAY = "2026-08-28";

describe("resolvePeriod — the 13-month cap and the future clamp (§6.3, §7.2)", () => {
  it("caps a 3-year request at 13 calendar months and reports the cap", () => {
    const p = resolvePeriod({ startDate: "2023-01-01", endDate: TODAY, now: NOW });
    // A calendar cap, not 13 * 30 days: the day after the same day-of-month 13 months back.
    const floor = addDays(addMonths(TODAY, -UI_MONTH_CAP), 1);
    assert.equal(floor, "2025-07-29");
    assert.equal(p.capFloor, floor);
    assert.equal(p.from, floor);
    assert.equal(p.capped, true);
    assert.equal(p.requestedFrom, "2023-01-01");
    assert.equal(p.days, dayCountInclusive(floor, TODAY));
  });

  it("does not cap a window that starts on the floor, and caps one a day earlier", () => {
    const floor = addDays(addMonths(TODAY, -UI_MONTH_CAP), 1);
    assert.equal(resolvePeriod({ startDate: floor, endDate: TODAY, now: NOW }).capped, false);
    const justOver = resolvePeriod({ startDate: addDays(floor, -1), endDate: TODAY, now: NOW });
    assert.equal(justOver.capped, true);
    assert.equal(justOver.from, floor);
  });

  it("clamps a request that reaches into the future to today, and reports the clamp", () => {
    const p = resolvePeriod({ startDate: "2026-08-01", endDate: "2026-12-31", now: NOW });
    assert.equal(p.to, TODAY);
    assert.equal(p.clampedEnd, true);
    assert.equal(p.requestedTo, "2026-12-31");
    assert.equal(p.capped, false);
  });

  it("a window wholly in the future degenerates to today, and one wholly before the floor to the floor", () => {
    const future = resolvePeriod({ startDate: "2027-01-01", endDate: "2027-02-01", now: NOW });
    assert.deepEqual([future.from, future.to, future.days, future.clampedEnd], [TODAY, TODAY, 1, true]);
    const past = resolvePeriod({ startDate: "2020-01-01", endDate: "2020-02-01", now: NOW });
    assert.deepEqual([past.from, past.to, past.capped], [past.capFloor, past.capFloor, true]);
  });

  it("both clamps can fire at once and both are reported", () => {
    const p = resolvePeriod({ startDate: "2020-01-01", endDate: "2030-01-01", now: NOW });
    assert.equal(p.capped, true);
    assert.equal(p.clampedEnd, true);
    assert.equal(p.from, p.capFloor);
    assert.equal(p.to, TODAY);
  });

  it("startDate after endDate is a 400, not a silently swapped window", () => {
    assert.throws(
      () => resolvePeriod({ startDate: "2026-08-20", endDate: "2026-08-01", now: NOW }),
      (e: unknown) => e instanceof PeriodError && e.status === 400 && e.message === "startDate must be before endDate",
    );
  });

  it("`months` with no dates is the last N calendar months, today included", () => {
    const p = resolvePeriod({ months: 12, now: NOW });
    assert.equal(p.from, "2025-08-29");
    assert.equal(p.to, TODAY);
    assert.equal(p.capped, false);
    assert.equal(resolvePeriod({ months: 36, now: NOW }).capped, true);
  });

  it("the granularity is daily unless a known one is asked for", () => {
    const at = (granularity: string | null) =>
      resolvePeriod({ startDate: TODAY, endDate: TODAY, granularity, now: NOW }).granularity;
    assert.equal(at("monthly"), "monthly");
    assert.equal(at("quarterly"), "quarterly");
    assert.equal(at("alldays"), "daily");
    assert.equal(at(null), "daily");
  });

  it("across a DST change the day COUNT is civil and the instants are local midnights", () => {
    const spring = resolvePeriod({ startDate: "2026-03-25", endDate: "2026-03-30", now: new Date("2026-03-30T09:00:00Z") });
    assert.equal(spring.days, 6);
    assert.equal(spring.fromTs.toISOString(), "2026-03-24T22:00:00.000Z");
    assert.equal(spring.toTsExclusive.toISOString(), "2026-03-30T21:00:00.000Z");
    assert.equal((spring.toTsExclusive.getTime() - spring.fromTs.getTime()) / 3600000, 6 * 24 - 1);

    const autumn = resolvePeriod({ startDate: "2026-10-23", endDate: "2026-10-28", now: new Date("2026-10-28T09:00:00Z") });
    assert.equal(autumn.days, 6);
    assert.equal((autumn.toTsExclusive.getTime() - autumn.fromTs.getTime()) / 3600000, 6 * 24 + 1);
  });
});

describe("toBusinessDay — what a request sent", () => {
  it("takes YYYY-MM-DD literally and reads an instant in Asia/Jerusalem", () => {
    assert.equal(toBusinessDay("2026-03-27"), "2026-03-27");
    // 23:30 local on the 26th is still the 26th; 00:30 local is the 27th.
    assert.equal(toBusinessDay("2026-03-26T21:30:00Z"), "2026-03-26");
    assert.equal(toBusinessDay("2026-03-26T22:30:00Z"), "2026-03-27");
    assert.equal(toBusinessDay(""), null);
    assert.equal(toBusinessDay("not a date"), null);
  });
});
