import { test } from "node:test";
import assert from "node:assert/strict";

import { durationParts, formatCivilRange, presetRange } from "../summary-range";

// 2026-11-26 is a Thursday.
const TODAY = "2026-11-26";

test("presets are calendar periods ending today", () => {
  assert.deepEqual(presetRange("today", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(presetRange("week", TODAY), { from: "2026-11-22", to: TODAY });
  assert.deepEqual(presetRange("month", TODAY), { from: "2026-11-01", to: TODAY });
  assert.deepEqual(presetRange("quarter", TODAY), { from: "2026-10-01", to: TODAY });
});

test("the week starts on Sunday, and Sunday is its own first day", () => {
  assert.deepEqual(presetRange("week", "2026-11-22"), { from: "2026-11-22", to: "2026-11-22" });
  assert.deepEqual(presetRange("week", "2026-11-28"), { from: "2026-11-22", to: "2026-11-28" });
});

test("quarters start in January, April, July and October", () => {
  assert.equal(presetRange("quarter", "2026-03-31")?.from, "2026-01-01");
  assert.equal(presetRange("quarter", "2026-04-01")?.from, "2026-04-01");
  assert.equal(presetRange("quarter", "2026-09-15")?.from, "2026-07-01");
});

test("a custom range counts only once both ends are picked, in order", () => {
  assert.equal(presetRange("custom", TODAY), null);
  assert.equal(presetRange("custom", TODAY, { from: "2026-11-01" }), null);
  assert.equal(presetRange("custom", TODAY, { from: "2026-11-20", to: "2026-11-01" }), null);
  assert.deepEqual(presetRange("custom", TODAY, { from: "2026-11-01", to: "2026-11-20" }), {
    from: "2026-11-01",
    to: "2026-11-20",
  });
});

test("one day reads with its weekday; a range reads as a range", () => {
  assert.match(formatCivilRange({ from: TODAY, to: TODAY }), /חמישי/);
  const range = formatCivilRange({ from: "2026-11-22", to: TODAY });
  assert.match(range, /22/);
  assert.match(range, /26/);
  assert.match(range, /נובמבר/);
});

test("the wall clock reads in days and hours, the work clock in hours and minutes", () => {
  const sixDaysTwoHours = (6 * 24 + 2) * 3600;
  assert.deepEqual(durationParts(sixDaysTwoHours, "day"), [
    { n: 6, unit: "ימים" },
    { n: 2, unit: "שע׳" },
  ]);
  assert.deepEqual(durationParts(sixDaysTwoHours, "hour"), [{ n: 146, unit: "שע׳" }]);
  assert.deepEqual(durationParts(33 * 3600 + 10 * 60, "hour"), [
    { n: 33, unit: "שע׳" },
    { n: 10, unit: "דק׳" },
  ]);
  assert.deepEqual(durationParts(24 * 3600, "day"), [{ n: 1, unit: "יום" }]);
  assert.deepEqual(durationParts(45 * 60, "day"), [{ n: 45, unit: "דק׳" }]);
});

test("an unmeasured duration is no parts at all, never zero", () => {
  assert.equal(durationParts(null, "day"), null);
  assert.equal(durationParts(undefined, "hour"), null);
  assert.equal(durationParts(Number.NaN, "hour"), null);
});
