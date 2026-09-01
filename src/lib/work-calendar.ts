// The work-calendar rebuild — the single connection between the שעות עבודה
// settings screen and the metrics ledger's work_seconds clock (plan §3.5/§7.4):
//
//   weekday_defaults + workday_overrides + department_holidays + hebcal
//       -> resolveRange(from, to)                 [TypeScript, pure]
//       -> rebuildWorkCalendar(prisma)            [ONE transaction: TEMP stage + build + flip]
//       -> work_span (prefix-sum ladder, absolute instants)
//
// Called from POST /api/cron/rebuild-work-calendar (nightly 01:00) and, fire-
// and-forget, after every successful write on the work-hours settings routes.
//
// Rebuild policy (§7.4): rolling horizon [-24 months, +12 months]. A NEW
// calendar_version is created ONLY when the source_digest changed or the
// current horizon runs short — not every night (otherwise ~800k ladder rows a
// year with no way to prune). A healthy overlap-skip and a digest no-op both
// return normally; only real failures throw.
//
// Timezone contract (§3.5): this module ships ONLY civil data — "YYYY-MM-DD"
// dates and "HH:mm" clock strings. The conversion to absolute instants happens
// in SQL (work_calendar_build, AT TIME ZONE 'Asia/Jerusalem'), never in Node:
// the container's Node clock must not be trusted for calendar math.

import { createHash } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { resolveRange } from "@/lib/workHours/resolveDay";
import { getIsraeliHolidays } from "@/lib/workHours/israeliHolidays";
import { toWeekdayDefault, toOverride, toHoliday, stringToDbDate, dbDateToString } from "@/lib/workHours/serialize";
import { toMinutes, daysBetween } from "@/lib/workHours/time";
import type { DateString, ResolvedDay, Weekday, WeekdayDefault } from "@/lib/workHours/types";
import type { TransactionClient } from "@/app/lib/prisma";

/** Rolling horizon (§7.4): [-24 months, +12 months] around today. */
const HORIZON_MONTHS_BACK = 24;
const HORIZON_MONTHS_FORWARD = 12;

/**
 * "Horizon runs short" threshold. Aligned with the metrics_selfcheck self-heal
 * rule (§3.10 / §7.4: calendar_horizon_days < 60 triggers an in-process build),
 * so the nightly job regenerates well before the selfcheck ever has to.
 */
const MIN_HORIZON_DAYS = 60;

/** Same lock key the runJob wrapper derives for this job name (§10.1). */
const ADVISORY_LOCK_KEY = "job:rebuild-work-calendar";

/** Rows per INSERT statement: 3 params each, comfortably under pg's limit. */
const INSERT_BATCH_ROWS = 365;

export type RebuildWorkCalendarResult =
  | { status: "skipped_overlap" }
  | { status: "noop"; calendarVersion: number; horizonTo: DateString }
  | {
      status: "rebuilt";
      calendarVersion: number;
      spans: number;
      horizonFrom: DateString;
      horizonTo: DateString;
    };

/** Today as a civil date in the department's timezone, immune to the host TZ. */
function todayInJerusalem(): DateString {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}

/** Civil date `n` months away, day-of-month clamped to the target month. */
function addMonthsClamped(date: DateString, n: number): DateString {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm0 = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm0 + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm0 + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

interface StageRow {
  workDate: DateString;
  startHhmm: string;
  endHhmm: string;
}

/**
 * One resolved day → its continuous working windows. A break inside the day
 * splits it in two (07:00–15:35 with a 12:00–13:00 break → two spans, 455
 * net minutes); a missing/degenerate break leaves a single span. Zero-length
 * windows are dropped — work_span has CHECK (span_seconds > 0).
 */
function spansOfDay(day: ResolvedDay): StageRow[] {
  if (!day.isWorking || !day.start || !day.end) return [];
  const start = toMinutes(day.start);
  const end = toMinutes(day.end);
  if (end <= start) return [];

  const bs = day.breakStart ? toMinutes(day.breakStart) : null;
  const be = day.breakEnd ? toMinutes(day.breakEnd) : null;
  const breakValid = bs !== null && be !== null && bs < be && bs >= start && be <= end;

  const windows: Array<[string, string]> = breakValid
    ? [
        [day.start, day.breakStart as string],
        [day.breakEnd as string, day.end],
      ]
    : [[day.start, day.end]];

  return windows
    .filter(([s, e]) => toMinutes(e) > toMinutes(s))
    .map(([s, e]) => ({ workDate: day.date, startHhmm: s, endHhmm: e }));
}

/**
 * Rebuild (or verify) the versioned work calendar. Everything runs in ONE
 * interactive transaction on ONE connection — the TEMP stage table
 * (ON COMMIT DROP) is invisible to any other pool connection, so no statement
 * may escape the transaction (§3.5).
 *
 * A new work_calendar_version is created only when the source digest changed
 * or horizon_to is closer than MIN_HORIZON_DAYS (§7.4); otherwise this is a
 * cheap read-only no-op. Overlapping runs (nightly cron vs. a settings save)
 * are serialized by a pg advisory xact lock — the loser skips healthily.
 */
export async function rebuildWorkCalendar(prisma: PrismaClient): Promise<RebuildWorkCalendarResult> {
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${ADVISORY_LOCK_KEY}, 0)) AS locked`;
      if (!locked) return { status: "skipped_overlap" as const };
      return rebuildWorkCalendarInTx(tx);
    },
    { timeout: 240_000, maxWait: 5_000 },
  );
}

/**
 * The rebuild itself, on a caller-owned transaction and WITHOUT the lock.
 *
 * Split out for the two callers that already hold both: the runJob wrapper
 * (§10.1), which opens the single transaction and takes the very same
 * `job:rebuild-work-calendar` advisory key, and the metrics-selfcheck job, whose
 * §7.4 self-heal has to build the calendar inside its own run. Calling
 * rebuildWorkCalendar() from inside runJob would open a SECOND transaction on a
 * SECOND connection and then fail to take a lock the first one already holds —
 * every nightly rebuild would report a healthy skip and the horizon would rot.
 */
export async function rebuildWorkCalendarInTx(
  tx: TransactionClient,
): Promise<Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>> {
  const today = todayInJerusalem();
  const horizonFrom = addMonthsClamped(today, -HORIZON_MONTHS_BACK);
  const horizonTo = addMonthsClamped(today, HORIZON_MONTHS_FORWARD);

  // Source rows, read inside the transaction so the digest and the spans
  // are computed from the same snapshot a concurrent settings save cannot
  // split.
  const [defaultRows, overrideRows, holidayRows] = await Promise.all([
    tx.weekday_defaults.findMany({ orderBy: { weekday: "asc" } }),
    tx.workday_overrides.findMany({
      where: { work_date: { gte: stringToDbDate(horizonFrom), lte: stringToDbDate(horizonTo) } },
      orderBy: { work_date: "asc" },
    }),
    tx.department_holidays.findMany({
      where: { start_date: { lte: stringToDbDate(horizonTo) }, end_date: { gte: stringToDbDate(horizonFrom) } },
      orderBy: { id: "asc" },
    }),
  ]);

  const byWeekday = new Map<number, WeekdayDefault>();
  for (const r of defaultRows) byWeekday.set(r.weekday, toWeekdayDefault(r));
  const defaults = ([0, 1, 2, 3, 4, 5, 6] as Weekday[])
    .map((w) => byWeekday.get(w))
    .filter((d): d is WeekdayDefault => d !== undefined);

  const overrides = overrideRows.map(toOverride);
  const holidays = holidayRows.map(toHoliday);
  const israeli = getIsraeliHolidays(horizonFrom, horizonTo);

  // The hebcal year set is part of the digest: the national-holiday data is
  // computed per civil year, so when the rolling horizon crosses into a new
  // year the source changed even though no DB row did.
  const hebcalYears: number[] = [];
  for (let y = Number(horizonFrom.slice(0, 4)); y <= Number(horizonTo.slice(0, 4)); y++) {
    hebcalYears.push(y);
  }

  const sourceDigest = createHash("sha256")
    .update(
      JSON.stringify({
        defaults: defaults.map((d) => [d.weekday, d.isWorking, d.start, d.end, d.breakStart, d.breakEnd]),
        overrides: overrides.map((o) => [o.date, o.kind, o.start, o.end, o.breakStart, o.breakEnd]),
        holidays: holidays.map((h) => [h.startDate, h.endDate, h.isHalfDay, h.halfDayEndTime]),
        hebcalYears,
      }),
    )
    .digest("hex");

  // §7.4: a new version ONLY when the digest changed or the horizon is
  // short. Same digest + comfortable horizon = nothing to do.
  const current = await tx.$queryRaw<
    { calendar_version: number; horizon_to: Date; source_digest: string }[]
  >`SELECT calendar_version, horizon_to, source_digest FROM work_calendar_version WHERE is_current`;
  if (current.length > 0) {
    const cur = current[0];
    const curHorizonTo = dbDateToString(cur.horizon_to);
    if (cur.source_digest === sourceDigest && daysBetween(today, curHorizonTo) >= MIN_HORIZON_DAYS) {
      return { status: "noop" as const, calendarVersion: cur.calendar_version, horizonTo: curHorizonTo };
    }
  }

  const stageRows = resolveRange(horizonFrom, horizonTo, { defaults, overrides, holidays, israeli }).flatMap(
    spansOfDay,
  );

  const [{ calendar_version: ver }] = await tx.$queryRaw<{ calendar_version: number }[]>`
    INSERT INTO work_calendar_version (horizon_from, horizon_to, source_digest)
    VALUES (${horizonFrom}::date, ${horizonTo}::date, ${sourceDigest})
    RETURNING calendar_version`;

  // TEMP stage table — ON COMMIT DROP replaces any cleanup DELETE (§3.5).
  await tx.$executeRaw`CREATE TEMP TABLE work_span_stage(
    work_date date NOT NULL, start_hhmm text NOT NULL, end_hhmm text NOT NULL) ON COMMIT DROP`;

  for (let i = 0; i < stageRows.length; i += INSERT_BATCH_ROWS) {
    const batch = stageRows.slice(i, i + INSERT_BATCH_ROWS);
    await tx.$executeRaw`
      INSERT INTO work_span_stage (work_date, start_hhmm, end_hhmm)
      VALUES ${Prisma.join(
        batch.map((r) => Prisma.sql`(${r.workDate}::date, ${r.startHhmm}, ${r.endHhmm})`),
      )}`;
  }

  const [{ work_calendar_build: spans }] = await tx.$queryRaw<{ work_calendar_build: number }[]>`
    SELECT work_calendar_build(${ver}::int)`;

  await tx.$executeRaw`UPDATE work_calendar_version SET is_current = (calendar_version = ${ver})
                       WHERE is_current OR calendar_version = ${ver}`;

  return { status: "rebuilt" as const, calendarVersion: ver, spans, horizonFrom, horizonTo };
}
