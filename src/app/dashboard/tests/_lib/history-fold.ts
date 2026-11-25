import type { HistoryPoint } from "@/app/lib/dashboard/contract";
import { isNil } from "./format";

/**
 * Above 30 daily points the history dialog folds to weeks, here rather than on
 * the server (§16.5). Weeks are 7-point slices counted from the first point.
 * The fold is not one operation: a state count is a snapshot, so the week takes
 * its LAST day; a station's steps are additive (`additiveLine`), so they sum; a
 * cumulative line takes its last value; a duration is the plain mean of the
 * days that measured something, and stays null when none did — the gap has to
 * survive.
 */
export function foldWeekly(points: HistoryPoint[], additiveLine: boolean): HistoryPoint[] {
  if (points.length <= 30) return points;
  const weeks: HistoryPoint[][] = [];
  for (let i = 0; i < points.length; i += 7) weeks.push(points.slice(i, i + 7));

  const mean = (values: Array<number | null>) => {
    const real = values.filter((v): v is number => !isNil(v));
    return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length;
  };

  return weeks.map((week) => {
    const last = week[week.length - 1];
    return {
      date: last.date,
      isToday: week.some((p) => p.isToday),
      queue: last.queue,
      test: last.test,
      research: last.research,
      unmapped: last.unmapped,
      line: additiveLine ? week.reduce((sum, p) => sum + (p.line ?? 0), 0) : last.line,
      wait: { wall: mean(week.map((p) => p.wait.wall)), work: mean(week.map((p) => p.wait.work)) },
      handle: {
        wall: mean(week.map((p) => p.handle.wall)),
        work: mean(week.map((p) => p.handle.work)),
      },
    };
  });
}
