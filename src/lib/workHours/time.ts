// Pure time/date helpers for the work-hours feature. No I/O, no Date-now — safe
// to unit-test and to run on both server and client.

import type { DateString, TimeString, Weekday } from "./types";

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

/** 450 → "07:30". */
export function fromMinutes(mins: number): TimeString {
  const m = Math.max(0, Math.round(mins));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
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

/**
 * Net worked minutes = (end - start) - break, clamped at 0.
 * A break is subtracted only when it is a valid interval inside the day.
 */
export function netMinutes(
  start: TimeString | null,
  end: TimeString | null,
  breakStart: TimeString | null,
  breakEnd: TimeString | null,
): number {
  if (!start || !end) return 0;
  const span = toMinutes(end) - toMinutes(start);
  if (span <= 0) return 0;
  let brk = 0;
  if (breakStart && breakEnd) {
    const b = toMinutes(breakEnd) - toMinutes(breakStart);
    if (b > 0) brk = b;
  }
  return Math.max(0, span - brk);
}

/** 455 → "7h 35m". Never negative. */
export function formatNet(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/* ---------- civil date helpers (timezone-free "YYYY-MM-DD") ---------- */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a well-formed "YYYY-MM-DD". */
export function isValidDate(d: unknown): d is DateString {
  if (typeof d !== "string" || !DATE_RE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  if (m < 1 || m > 12 || day < 1 || day > 31) return false;
  // Reject impossible days (e.g. 2026-02-31) by round-tripping.
  const dt = new Date(y, m - 1, day);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === day;
}

/**
 * Weekday of a civil date, using LOCAL calendar components so it never shifts
 * by timezone: 0 = Sunday (ראשון) … 6 = Saturday (שבת).
 */
export function weekdayOf(date: DateString): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() as Weekday;
}

/** Format local calendar components as "YYYY-MM-DD" (no UTC shift). */
export function toDateString(d: Date): DateString {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Every civil date in [from, to] inclusive, ascending. */
export function eachDate(from: DateString, to: DateString): DateString[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const out: DateString[] = [];
  while (cur <= end) {
    out.push(toDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** The civil date `n` days after `date` (n may be negative). No UTC shift. */
export function addDays(date: DateString, n: number): DateString {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toDateString(dt);
}

/** Whole days from `from` to `to` (negative when `to` precedes `from`). */
export function daysBetween(from: DateString, to: DateString): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  // Round: a DST boundary inside the span makes the raw diff off by an hour.
  return Math.round(
    (new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86_400_000,
  );
}

/** First civil date of a month. `month0` is 0-based, like Date#getMonth. */
export function monthStartISO(year: number, month0: number): DateString {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
}

/**
 * LAST civil date of a month — 28/29/30/31 as the month actually has. Never
 * hard-code "-31": it produces impossible dates that fail isValidDate.
 */
export function monthEndISO(year: number, month0: number): DateString {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/** True when `date` is within [start, end] inclusive (string compare is safe for ISO). */
export function isDateInRange(date: DateString, start: DateString, end: DateString): boolean {
  return date >= start && date <= end;
}
