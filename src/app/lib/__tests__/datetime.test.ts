import { test } from "node:test";
import assert from "node:assert/strict";
import { docDateParts, formatDay, formatDocDate, formatMoment } from "../datetime";

// 22:30 UTC is already the next day in Israel: every format reads the business time zone.
const LATE = "2026-03-05T22:30:00Z";

test("printed documents: dd.mm.yyyy in Israel time, the time apart or after a dot; a dash for nothing", () => {
  assert.equal(formatDocDate(LATE), "06.03.2026");
  assert.equal(formatDocDate(new Date(LATE), true), "06.03.2026 · 00:30");
  assert.deepEqual(docDateParts(LATE), { date: "06.03.2026", time: "00:30" });
  assert.equal(formatDocDate(null), "—");
  assert.equal(formatDocDate("not a date"), "—");
  assert.deepEqual(docDateParts(undefined), { date: "—", time: "" });
});

test("item screens: the moment without seconds, the day alone; an em dash for nothing", () => {
  assert.equal(formatMoment(LATE), "06.03.2026, 00:30");
  assert.equal(formatDay(LATE), "06.03.2026");
  assert.equal(formatMoment(null), "—");
  assert.equal(formatDay("garbage"), "—");
});
