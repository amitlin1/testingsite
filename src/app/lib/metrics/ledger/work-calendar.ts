// The work-calendar rebuild — the single connection between the שעות עבודה
// settings screen and the metrics ledger's work_seconds clock (plan §3.5/§7.4):
//
//   weekday_defaults + workday_overrides + department_holidays + hebcal
//       -> resolveRange(from, to)                 [TypeScript, pure]
//       -> rebuildWorkCalendarInTx(tx)            [ONE transaction: TEMP stage + build + flip]
//       -> work_span (prefix-sum ladder, absolute instants)
//
// WHEN it runs (calendar-sync.ts): only when something changed — once when the
// app server starts (a no-op unless the calendar is missing, short or out of
// date) and right after every save on the work-hours screen. Nothing runs on a
// schedule and nothing outside the app is needed. The two /api/cron endpoints
// still exist as manual tools for an operator.
//
// Rebuild policy (§7.4): horizon [-24 months, +60 months] around the day it is
// built. A NEW calendar_version is created ONLY when the source_digest changed
// or the current horizon runs short (under CALENDAR_MIN_HORIZON_DAYS). A digest
// no-op returns normally; only real failures throw.
//
// Timezone contract (§3.5): this module ships ONLY civil data — "YYYY-MM-DD"
// dates and "HH:mm" clock strings. The conversion to absolute instants happens
// in SQL (work_calendar_build, AT TIME ZONE 'Asia/Jerusalem'), never in Node:
// the container's Node clock must not be trusted for calendar math.

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { addMonths, businessDay, dayDiff } from "@/lib/time/civil";
import { loadWorkHoursSources } from "@/lib/workHours/load";
import { resolveRange } from "@/lib/workHours/resolveDay";
import { dbDateToString } from "@/lib/workHours/serialize";
import { workingWindows } from "@/lib/workHours/time";
import type { DateString, ResolvedDay } from "@/lib/workHours/types";
import type { TransactionClient } from "@/lib/db";

/**
 * Horizon: [-24 months, +60 months] around the day it is built. FIVE YEARS
 * FORWARD so nothing has to roll it on a schedule: the calendar is rebuilt only
 * when the work hours change or the server starts, and a version built today
 * stays valid for years (~3,500 ladder rows a version — tiny).
 */
const HORIZON_MONTHS_BACK = 24;
const HORIZON_MONTHS_FORWARD = 60;

/**
 * "Horizon runs short" (§3.10 / §7.4): with fewer days left than this, a
 * rebuild publishes a new version even when the source digest is unchanged.
 */
export const CALENDAR_MIN_HORIZON_DAYS = 60;

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

interface StageRow {
  workDate: DateString;
  startHhmm: string;
  endHhmm: string;
}

function spansOfDay(day: ResolvedDay): StageRow[] {
  if (!day.isWorking) return [];
  return workingWindows(day.start, day.end, day.breakStart, day.breakEnd).map(([s, e]) => ({
    workDate: day.date,
    startHhmm: s,
    endHhmm: e,
  }));
}

/**
 * Rebuild (or verify) the versioned work calendar, on a caller-owned
 * transaction — always runJob's, which holds the job's advisory lock. The TEMP
 * stage table (ON COMMIT DROP) is invisible to any other pool connection, so no
 * statement may escape the transaction (§3.5).
 *
 * A new work_calendar_version is created only when the source digest changed
 * or horizon_to is closer than CALENDAR_MIN_HORIZON_DAYS (§7.4); otherwise this
 * is a cheap read-only no-op.
 */
export async function rebuildWorkCalendarInTx(
  tx: TransactionClient,
): Promise<Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>> {
  const today = businessDay();
  const horizonFrom = addMonths(today, -HORIZON_MONTHS_BACK);
  const horizonTo = addMonths(today, HORIZON_MONTHS_FORWARD);

  // Source rows, read inside the transaction so the digest and the spans
  // are computed from the same snapshot a concurrent settings save cannot
  // split.
  const { defaults, overrides, holidays } = await loadWorkHoursSources(tx, horizonFrom, horizonTo);

  // @hebcal/core is ESM-only ("import" condition, no "require"). A static import
  // would make this module, and every route importing it, unloadable under the
  // node:test runner, which compiles it to CommonJS.
  const { getIsraeliHolidays } = await import("@/lib/workHours/israeliHolidays");
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

  const current = await tx.$queryRaw<
    { calendar_version: number; horizon_to: Date; source_digest: string }[]
  >`SELECT calendar_version, horizon_to, source_digest FROM work_calendar_version WHERE is_current`;
  if (current.length > 0) {
    const cur = current[0];
    const curHorizonTo = dbDateToString(cur.horizon_to);
    if (cur.source_digest === sourceDigest && dayDiff(today, curHorizonTo) >= CALENDAR_MIN_HORIZON_DAYS) {
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

/**
 * Rows reconciled per transaction. Measured on the seeded dev dataset: the
 * work_seconds_between expression over 5,796 closed intervals costs 2.38 s
 * (~0.41 ms a row), and a whole run of this endpoint — calendar rebuild plus a
 * reconciliation of all 5,798 intervals — took 3.5–3.7 s. 50k rows is therefore
 * ~20 s, comfortably inside runJob's 240 s budget with the rebuild in front of
 * it. calendar-sync.ts loops batch after batch until nothing is left.
 */
export const RECONCILE_BATCH_ROWS = 50_000;

/**
 * Recompute work_seconds for closed intervals still stamped with a superseded
 * calendar_version — the reconciliation of §7.4, which `intervals_stale_calendar`
 * exists to track ("what has not been recomputed yet"). A holiday entered late,
 * or 15:30 corrected to 15:35, changes past numbers by design; without this the
 * ledger would keep reporting the pre-correction durations forever. An interval
 * closed while no calendar existed at all (calendar_version NULL, work_seconds
 * NULL) is stale too: IS DISTINCT FROM catches it.
 *
 * The expression is character-for-character the one isi_apply_one uses when it
 * closes an interval, so a reconciled row is indistinguishable from one folded
 * under the new calendar in the first place. wall_seconds is untouched — it is
 * calendar-independent (§2.8).
 *
 * SCOPED TO THE CURRENT HORIZON, and that is not an optimisation.
 * work_seconds_between returns NULL for an interval outside the version's
 * [horizon_from, horizon_to], so an unscoped recompute would ERASE the correct
 * work_seconds of every interval older than the rolling 24-month window the day
 * a new version is published. Out-of-horizon rows keep their old value and their
 * old calendar_version; they surface in intervals_stale_calendar rather than
 * being silently destroyed.
 */
export async function reconcileStaleCalendar(tx: TransactionClient): Promise<number> {
  return tx.$executeRaw`
    WITH cur AS (
      SELECT calendar_version, horizon_from, horizon_to
        FROM work_calendar_version WHERE is_current
    ), stale AS (
      SELECT i.interval_id
        FROM item_state_interval i, cur c
       WHERE i.closed_at IS NOT NULL
         AND NOT i.is_terminal
         AND i.calendar_version IS DISTINCT FROM c.calendar_version
         AND business_date(lower(i.valid_range)) >= c.horizon_from
         AND business_date(i.closed_at)          <= c.horizon_to
       ORDER BY i.interval_id
       LIMIT ${RECONCILE_BATCH_ROWS}
    )
    UPDATE item_state_interval i
       SET work_seconds     = work_seconds_between(lower(i.valid_range), i.closed_at, c.calendar_version),
           calendar_version = c.calendar_version
      FROM stale s, cur c
     WHERE i.interval_id = s.interval_id`;
}

export type WorkCalendarSync = {
  calendar: Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>;
  reconciledIntervals: number;
};

/**
 * Bring the ledger in line with the work-hours settings, in the caller's
 * transaction: rebuild the calendar if its sources changed (a no-op otherwise),
 * then recompute up to RECONCILE_BATCH_ROWS intervals still stamped with an
 * older version — or with none, for intervals closed before any calendar existed.
 */
export async function syncWorkCalendarInTx(tx: TransactionClient): Promise<WorkCalendarSync> {
  const calendar = await rebuildWorkCalendarInTx(tx);
  const reconciledIntervals = await reconcileStaleCalendar(tx);
  return { calendar, reconciledIntervals };
}
