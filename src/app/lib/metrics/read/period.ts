// The window a ledger query runs over: business days in Asia/Jerusalem (§7.2),
// capped at 13 months back (§6.3) and clamped at today, both clamps REPORTED to
// the caller rather than applied in silence. With no cache and no rollup (§6),
// the 13-month cap is what bounds the work, so it is enforced here and never
// trusted to the client.

import { UI_MONTH_CAP } from "@/app/lib/dashboard/contract";
import { HttpError } from "@/lib/http/errors";
import {
  addDays,
  addMonths,
  businessDay,
  dayCountInclusive,
  startOfBusinessDay,
  type CivilDate,
} from "@/lib/time/civil";

/** A civil date read as a business day in Asia/Jerusalem. */
export type BusinessDay = CivilDate;

/** Bucket width for the day-series and flow queries. */
export type Granularity = "daily" | "monthly" | "quarterly";

export const GRANULARITIES: readonly Granularity[] = ["daily", "monthly", "quarterly"];

export function isGranularity(v: unknown): v is Granularity {
  return GRANULARITIES.includes(v as Granularity);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedPeriod {
  /** Inclusive first business day. */
  from: BusinessDay;
  /** Inclusive last business day. */
  to: BusinessDay;
  /** The first instant of `from`. */
  fromTs: Date;
  /** The first instant of the day AFTER `to` — the window is half-open. */
  toTsExclusive: Date;
  /** Business days in [from, to]. */
  days: number;
  granularity: Granularity;
  /** Today, at the moment of resolution. */
  today: BusinessDay;
  /** The 13-month cap moved `from` forward. */
  capped: boolean;
  /** `to` was pulled back to today (a future `to` would make Q2 emit zero-filled
   *  days that never existed — §5.0(7) forbids that gap-fill). */
  clampedEnd: boolean;
  /** What was asked for, before the clamps — for the "showing X of Y" notice. */
  requestedFrom: BusinessDay;
  requestedTo: BusinessDay;
  /** The earliest day the cap allows right now. */
  capFloor: BusinessDay;
}

export class PeriodError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = "PeriodError";
  }
}

/** The instant the given business day ends (the start of the next one). */
export function endOfBusinessDayExclusive(day: BusinessDay): Date {
  return startOfBusinessDay(addDays(day, 1));
}

/**
 * What a request sent, as a business day. 'YYYY-MM-DD' is taken literally — a
 * civil day already. Anything else is parsed as an instant and converted
 * through Asia/Jerusalem.
 */
export function toBusinessDay(value: string | Date | null | undefined): BusinessDay | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : businessDay(value);
  const s = String(value).trim();
  if (s === "") return null;
  if (DAY_RE.test(s)) return s;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : businessDay(t);
}

/** The window of the last `months` calendar months, today included. */
function monthsBack(today: BusinessDay, months: number): BusinessDay {
  return addDays(addMonths(today, -months), 1);
}

export interface PeriodInput {
  /** An explicit window — both ends or neither. */
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  /** With no explicit window: the last `months` calendar months, today included. */
  months?: number;
  /** daily | monthly | quarterly; anything else is daily. */
  granularity?: string | null;
  /** Injectable clock, for tests. */
  now?: Date;
}

/**
 * The window a request asked for, capped and clamped. A calendar cap, not
 * 13 × 30 days: it is what the picker shows, and a day-count cap drifts from it.
 * A window wholly outside [cap floor, today] degenerates to that one boundary
 * day rather than to an error.
 */
export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  const today = businessDay(input.now ?? new Date());
  const granularity: Granularity = isGranularity(input.granularity) ? input.granularity : "daily";

  const start = toBusinessDay(input.startDate);
  const end = toBusinessDay(input.endDate);
  let requestedFrom: BusinessDay;
  let requestedTo: BusinessDay;
  if (start && end) {
    requestedFrom = start;
    requestedTo = end;
  } else if (input.months !== undefined) {
    requestedFrom = monthsBack(today, input.months);
    requestedTo = today;
  } else {
    throw new Error("resolvePeriod needs startDate + endDate, or months");
  }
  if (requestedFrom > requestedTo) throw new PeriodError("startDate must be before endDate");

  const capFloor = monthsBack(today, UI_MONTH_CAP);
  const capped = requestedFrom < capFloor;
  const clampedEnd = requestedTo > today;
  let from = capped ? capFloor : requestedFrom;
  let to = clampedEnd ? today : requestedTo;
  if (from > to) from = to = capped ? capFloor : today;

  return {
    from,
    to,
    fromTs: startOfBusinessDay(from),
    toTsExclusive: endOfBusinessDayExclusive(to),
    days: dayCountInclusive(from, to),
    granularity,
    today,
    capped,
    clampedEnd,
    requestedFrom,
    requestedTo,
    capFloor,
  };
}

/** The `date_trunc` unit of a granularity, so no caller re-decides what "quarterly" means. */
export function truncUnit(g: Granularity): "day" | "month" | "quarter" {
  return g === "monthly" ? "month" : g === "quarterly" ? "quarter" : "day";
}
