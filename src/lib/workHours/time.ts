// The department's default hours and the "HH:mm" clock arithmetic of the
// work-hours feature. Civil dates live in @/lib/time/civil.

import type { TimeString } from "./types";

/* ---------- department default hours (matches the seeded template) ---------- */

export const DEFAULT_START: TimeString = "07:00";
export const DEFAULT_END: TimeString = "15:35";
export const DEFAULT_BREAK_START: TimeString = "12:00";
export const DEFAULT_BREAK_END: TimeString = "13:00";

/** Half day (שישי / ערב חג / יום הזיכרון / יום השואה): 07:00–12:00, no break. */
export const HALF_DAY_START: TimeString = "07:00";
export const HALF_DAY_END: TimeString = "12:00";

/* ---------- HH:mm arithmetic ---------- */

/** "07:30" → 450. Null/empty → 0. */
export function toMinutes(t: TimeString | null | undefined): number {
  if (!t) return 0;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when `t` is a well-formed 24h "HH:mm" in [00:00, 23:59]. */
export function isValidTime(t: unknown): t is TimeString {
  if (typeof t !== "string") return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59;
}

/** True when end is NOT strictly after start (the validation the user asked for). */
export function isEndBeforeStart(start: TimeString, end: TimeString): boolean {
  return toMinutes(end) <= toMinutes(start);
}

/** Half-day work (שישי / ערב חג) may not end after HALF_DAY_END. */
export function exceedsHalfDayCap(end: TimeString): boolean {
  return toMinutes(end) > toMinutes(HALF_DAY_END);
}

/**
 * The continuous working windows of one day — what the settings screen nets
 * and what the ledger's work clock counts (work_span). A break splits the day
 * only when it is a real interval inside [start, end]; any other break is
 * ignored. Zero-length windows are dropped: work_span has CHECK (span_seconds > 0).
 */
export function workingWindows(
  start: TimeString | null,
  end: TimeString | null,
  breakStart: TimeString | null,
  breakEnd: TimeString | null,
): Array<[TimeString, TimeString]> {
  if (!start || !end) return [];
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (e <= s) return [];
  const bs = breakStart ? toMinutes(breakStart) : null;
  const be = breakEnd ? toMinutes(breakEnd) : null;
  const windows: Array<[TimeString, TimeString]> =
    bs !== null && be !== null && bs < be && bs >= s && be <= e
      ? [
          [start, breakStart as TimeString],
          [breakEnd as TimeString, end],
        ]
      : [[start, end]];
  return windows.filter(([from, to]) => toMinutes(to) > toMinutes(from));
}

/** Net worked minutes: the length of the day's working windows. */
export function netMinutes(
  start: TimeString | null,
  end: TimeString | null,
  breakStart: TimeString | null,
  breakEnd: TimeString | null,
): number {
  return workingWindows(start, end, breakStart, breakEnd).reduce(
    (sum, [from, to]) => sum + toMinutes(to) - toMinutes(from),
    0,
  );
}

/** 455 → "7h 35m". Never negative. */
export function formatNet(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
