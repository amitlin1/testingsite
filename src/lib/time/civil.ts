// Civil dates ("YYYY-MM-DD") and the business day.
//
// A civil date carries no time of day and no zone, so its arithmetic runs on UTC
// components and gives the same answer in every process timezone. The one zone
// that matters is the business day's: §7.2 of docs/architecture/dashboard-migration-plan-v2.md
// defines it as `(ts AT TIME ZONE 'Asia/Jerusalem')::date`, the same rule the
// database's business_date(ts) applies. Intl carries the IANA rules, so the two
// DST changes a year are never hardcoded as +02/+03.

/** The zone the business day is defined in (§7.2). */
export const BUSINESS_TZ = "Asia/Jerusalem";

/** "YYYY-MM-DD". Kept as a string: a Date cannot hold a civil day without a zone. */
export type CivilDate = string;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The two weekdays the work calendar names (weekdayOf numbering: 0 = Sunday). */
export const FRIDAY: Weekday = 5;
export const SATURDAY: Weekday = 6;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parts(day: CivilDate): [number, number, number] {
  if (!DAY_RE.test(day)) throw new Error(`not a civil date (YYYY-MM-DD): ${JSON.stringify(day)}`);
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

function fromUtc(ms: number): CivilDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A well-formed date that exists (2026-02-31 does not). */
export function isCivilDate(v: unknown): v is CivilDate {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  return fromUtc(Date.UTC(y, m - 1, d)) === v;
}

/** A Date's own LOCAL calendar day — for Dates built in local time (a date
 *  picker, @hebcal's greg()). Never for an instant: use businessDay(). */
export function localCivilDate(d: Date): CivilDate {
  return `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function addDays(day: CivilDate, n: number): CivilDate {
  const [y, m, d] = parts(day);
  return fromUtc(Date.UTC(y, m - 1, d + n));
}

/** Calendar months, the day clamped to the target month's last day (Jan 31 + 1 = Feb 28). */
export function addMonths(day: CivilDate, n: number): CivilDate {
  const [y, m, d] = parts(day);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m - 1 + n, Math.min(d, lastDay)));
}

/** `to − from` in days: 0 for the same day, negative when `to` comes first. */
export function dayDiff(from: CivilDate, to: CivilDate): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/** How many days [from, to] holds, both ends counted: 1 for a single day. */
export function dayCountInclusive(from: CivilDate, to: CivilDate): number {
  return dayDiff(from, to) + 1;
}

/** Every date in [from, to], ascending. */
export function eachDate(from: CivilDate, to: CivilDate): CivilDate[] {
  const out: CivilDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday (ראשון) … 6 = Saturday (שבת). */
export function weekdayOf(day: CivilDate): Weekday {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as Weekday;
}

/** First day of a month; `month0` is 0-based, like Date#getMonth. */
export function monthStart(year: number, month0: number): CivilDate {
  return fromUtc(Date.UTC(year, month0, 1));
}

/** Last day of a month — 28/29/30/31 as the month really has. */
export function monthEnd(year: number, month0: number): CivilDate {
  return fromUtc(Date.UTC(year, month0 + 1, 0));
}

// ---------------------------------------------------------------------------
// The business day — Asia/Jerusalem
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

/** The business day an instant falls on — the JS twin of SQL business_date(ts). */
export function businessDay(at: Date | number = new Date()): CivilDate {
  return dayFmt.format(at);
}

function zoneOffsetMinutes(at: Date): number {
  const p = partsFmt.formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  // Some engines render midnight as hour 24 on a 24-hour locale.
  const hour = g("hour") % 24;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * The instant a business day begins. Two passes: guess with the offset at the
 * naive UTC point, then re-derive it at the candidate. Israel changes clocks at
 * 02:00, never at midnight, so the second pass lands on 00:00:00 exactly.
 */
export function startOfBusinessDay(day: CivilDate): Date {
  const [y, m, d] = parts(day);
  const naive = Date.UTC(y, m - 1, d);
  let ts = naive - zoneOffsetMinutes(new Date(naive)) * 60000;
  ts = naive - zoneOffsetMinutes(new Date(ts)) * 60000;
  return new Date(ts);
}
