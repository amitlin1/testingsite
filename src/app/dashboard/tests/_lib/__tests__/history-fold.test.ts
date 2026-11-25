// The weekly fold the history dialog draws (foldWeekly), as it ships.
import { test } from "node:test";
import assert from "node:assert/strict";

import type { HistoryPoint } from "@/app/lib/dashboard/contract";
import { foldWeekly } from "../history-fold";

function day(i: number, patch: Partial<HistoryPoint> = {}): HistoryPoint {
  return {
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    isToday: false,
    queue: i,
    test: 100 + i,
    research: 200 + i,
    unmapped: 0,
    line: i,
    wait: { wall: null, work: null },
    handle: { wall: null, work: null },
    ...patch,
  };
}

const days = (n: number, patch: (i: number) => Partial<HistoryPoint> = () => ({})) =>
  Array.from({ length: n }, (_, i) => day(i, patch(i)));

test("30 points or fewer are drawn daily, untouched", () => {
  const points = days(30);
  assert.equal(foldWeekly(points, false), points);
  assert.equal(foldWeekly([], true).length, 0);
});

test("above 30 points: 7-point slices counted from the first point, the last slice short", () => {
  const folded = foldWeekly(days(31), false);
  assert.deepEqual(
    folded.map((w) => w.date),
    ["2026-01-07", "2026-01-14", "2026-01-21", "2026-01-28", "2026-01-31"],
  );
});

test("state counts take the week's LAST day, not its mean", () => {
  const [first, , , , last] = foldWeekly(days(31), false);
  assert.deepEqual([first.queue, first.test, first.research], [6, 106, 206]);
  assert.deepEqual([last.queue, last.test, last.research], [30, 130, 230]);
});

test("a station's steps (additive) sum over the week, a null day counting as 0", () => {
  const folded = foldWeekly(days(31, (i) => ({ line: i === 3 ? null : 1 })), true);
  assert.deepEqual(folded.map((w) => w.line), [6, 7, 7, 7, 3]);
});

test("a cumulative line takes the week's last value", () => {
  const folded = foldWeekly(days(31), false);
  assert.deepEqual(folded.map((w) => w.line), [6, 13, 20, 27, 30]);
});

test("durations are the plain mean of the days that measured, null when none did", () => {
  const folded = foldWeekly(
    days(35, (i) => ({
      // Week 1: 10 and 40 measured, the rest null. Week 2: nothing measured.
      wait: { wall: i === 0 ? 10 : i === 1 ? 40 : null, work: i === 0 ? 5 : null },
      handle: { wall: i < 7 ? 2 : null, work: null },
    })),
    false,
  );
  assert.deepEqual(folded[0].wait, { wall: 25, work: 5 });
  assert.deepEqual(folded[0].handle, { wall: 2, work: null });
  assert.deepEqual(folded[1].wait, { wall: null, work: null });
});

test("a week is today's when any of its days is", () => {
  const folded = foldWeekly(days(31, (i) => ({ isToday: i === 29 })), false);
  assert.deepEqual(folded.map((w) => w.isToday), [false, false, false, false, true]);
});
