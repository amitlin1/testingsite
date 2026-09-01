// Period resolution for the ledger read path — §6.3 (the 13-month UI cap) and
// §7.2 (the Asia/Jerusalem business-day boundary), written once.
//
// WHAT THIS REPLACES
// ------------------
// src/app/lib/date-periods.ts and src/app/lib/dashboard-date-range.ts both
// build ranges out of `new Date()` + `setHours()` + `toISOString().split('T')[0]`.
// That is the process's LOCAL midnight rendered as a UTC calendar day: on a
// UTC-TZ container it stretches every dashboard window to [start-1, end+1], and
// on any other TZ it silently reports someone else's day. §7.2 bans both.
// Here the business day is `(ts AT TIME ZONE 'Asia/Jerusalem')::date`, computed
// with the IANA database via Intl — the same definition the DB's
// business_date(ts) applies at fold time, so the JS side and the SQL side can
// never drift.
//
// WIRE COMPATIBILITY
// ------------------
// The existing endpoints accept `startDate` + `endDate` (either 'YYYY-MM-DD' or
// a full ISO instant, because the client sends `toISOString()`), plus `period`
// which on `tests/average-times` means the GRANULARITY (daily|monthly|quarterly)
// and nowhere else means a range. Both spellings are accepted here, plus the
// named range presets the pickers offer, so the new layer is a drop-in.
//
// NO CACHE, NO ROLLUP (§6). The only thing bounding the work is the 13-month
// cap, which is therefore enforced here rather than trusted to the client.

import type { MetricsScope } from "./filters";

/** §6.3 — every dashboard date picker is capped at 13 months back. */
export const UI_MONTH_CAP = 13;

/** §7.2 — the one timezone the business day is defined in. */
export const BUSINESS_TZ = "Asia/Jerusalem";

/** Bucket width for the day-series and flow queries. */
export type Granularity = "daily" | "monthly" | "quarterly";

const GRANULARITIES: readonly string[] = ["daily", "monthly", "quarterly"];

/** 'YYYY-MM-DD' in Asia/Jerusalem. Kept as a string: a Date cannot represent a
 *  civil day without re-introducing a timezone. */
export type BusinessDay = string;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedPeriod {
  /** Inclusive first business day. */
  from: BusinessDay;
  /** Inclusive last business day. */
  to: BusinessDay;
  /** Instant of the first moment of `from`, Asia/Jerusalem. */
  fromTs: Date;
  /** Instant of the first moment of the day AFTER `to` — the window is half-open. */
  toTsExclusive: Date;
  /** Number of business days in [from, to]. */
  days: number;
  granularity: Granularity;
  scope: MetricsScope;
  /** Today, in Asia/Jerusalem, at the moment of resolution. */
  today: BusinessDay;
  /** True when the 13-month cap moved `from` forward. */
  capped: boolean;
  /** True when `to` was clamped back to today (a future `to` would make Q2 emit
   *  zero-filled days that never existed — §5.0(7) forbids that gap-fill). */
  clampedEnd: boolean;
  /** What the caller asked for, before capping — for the "showing X of Y" notice. */
  requestedFrom: BusinessDay;
  requestedTo: BusinessDay;
  /** Earliest day the cap allows right now. */
  capFloor: BusinessDay;
}

// ---------------------------------------------------------------------------
// Asia/Jerusalem primitives. Intl carries the IANA rules, including the two
// DST transitions a year that §7.3 is about, so nothing here hardcodes +02/+03.
// ---------------------------------------------------------------------------

const dayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** `business_date(ts)` — the JS twin of the SQL function (§7.2). */
export function businessDay(at: Date | number = new Date()): BusinessDay {
  return dayFmt.format(at);
}

/** Today in Asia/Jerusalem. */
export function todayBusinessDay(now: Date = new Date()): BusinessDay {
  return businessDay(now);
}

/** Offset of Asia/Jerusalem from UTC, in minutes, at a given instant. */
function tzOffsetMinutes(at: Date): number {
  const p = partsFmt.formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  // formatToParts on a 24-hour locale renders midnight as hour 24 in some
  // engines; normalise so the arithmetic below cannot land a day off.
  const hour = g("hour") % 24;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * The instant at which a business day begins in Asia/Jerusalem.
 *
 * Two passes: guess with the offset that applies at the naive UTC point, then
 * re-derive the offset at the candidate instant and re-apply it. Israel changes
 * clocks at 02:00, never at midnight, so the second pass always converges and
 * the resulting local wall clock is exactly 00:00:00.
 */
export function startOfBusinessDay(day: BusinessDay): Date {
  assertDay(day);
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let ts = naive - tzOffsetMinutes(new Date(naive)) * 60000;
  ts = naive - tzOffsetMinutes(new Date(ts)) * 60000;
  return new Date(ts);
}

/** The instant the given business day ends (== start of the next day). Half-open. */
export function endOfBusinessDayExclusive(day: BusinessDay): Date {
  return startOfBusinessDay(addDays(day, 1));
}

function assertDay(day: string): void {
  if (!DAY_RE.test(day)) throw new Error(`not a business day (YYYY-MM-DD): ${JSON.stringify(day)}`);
}

/** Civil-date arithmetic — never `timestamptz + interval '1 day'` (§7.3(2)). */
export function addDays(day: BusinessDay, n: number): BusinessDay {
  assertDay(day);
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Calendar-month arithmetic, clamping to the last day of a short month. */
export function addMonths(day: BusinessDay, n: number): BusinessDay {
  assertDay(day);
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const dd = Math.min(d, lastDay);
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), dd)).toISOString().slice(0, 10);
}

/** Inclusive day count between two business days. */
export function daysBetween(from: BusinessDay, to: BusinessDay): number {
  assertDay(from);
  assertDay(to);
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Coerce whatever the UI sent into a business day.
 *
 * 'YYYY-MM-DD' is taken literally — that is what the user picked in the date
 * picker and it is already a civil day. Anything else is parsed as an instant
 * and converted through Asia/Jerusalem, which is what makes the existing
 * clients (they send `toISOString()`) land on the right day.
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

// ---------------------------------------------------------------------------
// Range presets
// ---------------------------------------------------------------------------

/** Named ranges the pickers offer. `custom` means "use startDate/endDate". */
export type RangePreset =
  | "today"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "last90days"
  | "last12months"
  | "last13months"
  | "custom";

const RANGE_PRESETS: readonly string[] = [
  "today",
  "yesterday",
  "last7days",
  "last30days",
  "last90days",
  "last12months",
  "last13months",
  "custom",
];

function presetRange(preset: RangePreset, today: BusinessDay): { from: BusinessDay; to: BusinessDay } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7days":
      return { from: addDays(today, -6), to: today };
    case "last30days":
      return { from: addDays(today, -29), to: today };
    case "last90days":
      return { from: addDays(today, -89), to: today };
    case "last12months":
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case "last13months":
      return { from: addDays(addMonths(today, -UI_MONTH_CAP), 1), to: today };
    default:
      return { from: addDays(today, -29), to: today };
  }
}

export interface PeriodInput {
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  /** Either a granularity (daily|monthly|quarterly) or a range preset. */
  period?: string | null;
  granularity?: string | null;
  scope?: string | null;
  showAllHistory?: boolean;
  /** Relative presets from the old date-periods.ts PeriodOption. */
  days?: number | string | null;
  months?: number | string | null;
  years?: number | string | null;
  year?: number | string | null;
  /** Injectable clock, for tests. */
  now?: Date;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve UI params to a concrete, capped, Asia/Jerusalem business-day range.
 *
 * Precedence: explicit startDate/endDate > relative days/months/years/year >
 * named preset > 30-day default. Whatever the route, the 13-month cap and the
 * "no future days" clamp are applied last and reported, never applied silently.
 */
export function resolvePeriod(input: PeriodInput | URLSearchParams = {}): ResolvedPeriod {
  const p: PeriodInput =
    input instanceof URLSearchParams
      ? {
          startDate: input.get("startDate"),
          endDate: input.get("endDate"),
          period: input.get("period"),
          granularity: input.get("granularity"),
          scope: input.get("scope"),
          showAllHistory: input.get("showAllHistory") === "true",
          days: input.get("days"),
          months: input.get("months"),
          years: input.get("years"),
          year: input.get("year"),
        }
      : input;

  const now = p.now ?? new Date();
  const today = todayBusinessDay(now);

  // ---- granularity ---------------------------------------------------------
  const granularityRaw = (p.granularity ?? (GRANULARITIES.includes(String(p.period)) ? p.period : null)) ?? "daily";
  const granularity: Granularity = GRANULARITIES.includes(String(granularityRaw))
    ? (String(granularityRaw) as Granularity)
    : "daily";

  // ---- requested range -----------------------------------------------------
  let from = toBusinessDay(p.startDate ?? null);
  let to = toBusinessDay(p.endDate ?? null);

  if (!from || !to) {
    const year = num(p.year);
    const days = num(p.days);
    const months = num(p.months);
    const years = num(p.years);
    const preset = RANGE_PRESETS.includes(String(p.period)) ? (String(p.period) as RangePreset) : null;

    if (year !== null) {
      from = from ?? `${String(year).padStart(4, "0")}-01-01`;
      to = to ?? `${String(year).padStart(4, "0")}-12-31`;
    } else if (days !== null) {
      from = from ?? addDays(today, -(Math.max(1, Math.trunc(days)) - 1));
      to = to ?? today;
    } else if (months !== null) {
      from = from ?? addDays(addMonths(today, -Math.max(1, Math.trunc(months))), 1);
      to = to ?? today;
    } else if (years !== null) {
      from = from ?? addDays(addMonths(today, -12 * Math.max(1, Math.trunc(years))), 1);
      to = to ?? today;
    } else if (preset && preset !== "custom") {
      const r = presetRange(preset, today);
      from = from ?? r.from;
      to = to ?? r.to;
    } else {
      const r = presetRange("last30days", today);
      from = from ?? r.from;
      to = to ?? r.to;
    }
  }

  const requestedFrom = from as BusinessDay;
  const requestedTo = to as BusinessDay;

  if (requestedFrom > requestedTo) {
    throw new PeriodError(`startDate (${requestedFrom}) is after endDate (${requestedTo})`);
  }

  // ---- the two clamps, both reported --------------------------------------
  // §6.3: 13 months back, inclusive of today. Not "13 * 30 days" — a calendar
  // cap is what the picker shows, and a day-count cap drifts against it.
  const capFloor = addDays(addMonths(today, -UI_MONTH_CAP), 1);
  const capped = requestedFrom < capFloor;
  const clampedEnd = requestedTo > today;

  const finalFrom = capped ? capFloor : requestedFrom;
  const finalTo = clampedEnd ? today : requestedTo;

  if (finalFrom > finalTo) {
    // The whole requested window is older than the cap (or entirely in the
    // future). Degenerate but not an error: report the single boundary day.
    const day = capped ? capFloor : today;
    return build(day, day, granularity, p, today, capped, clampedEnd, requestedFrom, requestedTo, capFloor);
  }

  return build(
    finalFrom, finalTo, granularity, p, today, capped, clampedEnd, requestedFrom, requestedTo, capFloor
  );
}

function build(
  from: BusinessDay,
  to: BusinessDay,
  granularity: Granularity,
  p: PeriodInput,
  today: BusinessDay,
  capped: boolean,
  clampedEnd: boolean,
  requestedFrom: BusinessDay,
  requestedTo: BusinessDay,
  capFloor: BusinessDay
): ResolvedPeriod {
  const scope: MetricsScope =
    p.scope === "all" || p.showAllHistory === true
      ? "all"
      : p.scope === "open_shipments"
        ? "open_shipments"
        : "open_shipments";

  return {
    from,
    to,
    fromTs: startOfBusinessDay(from),
    toTsExclusive: endOfBusinessDayExclusive(to),
    days: daysBetween(from, to),
    granularity,
    scope,
    today,
    capped,
    clampedEnd,
    requestedFrom,
    requestedTo,
    capFloor,
  };
}

export class PeriodError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "PeriodError";
  }
}

/**
 * `date_trunc` unit for a granularity. Exposed so Q4's callers can roll days up
 * without each of them re-deciding what "quarterly" means.
 */
export function truncUnit(g: Granularity): "day" | "month" | "quarter" {
  return g === "monthly" ? "month" : g === "quarterly" ? "quarter" : "day";
}
