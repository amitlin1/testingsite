// The work-calendar rebuild — the single connection between the שעות עבודה
// settings screen and the metrics ledger's work_seconds clock (plan §3.5/§7.4):
//
//   weekday_defaults + workday_overrides + department_holidays + hebcal
//       -> resolveRange(from, to)                 [TypeScript, pure]
//       -> rebuildWorkCalendarInTx(tx)            [ONE transaction: TEMP stage + build + flip]
//       -> work_span (prefix-sum ladder, absolute instants)
//
// Callers: the nightly 01:00 job (POST /api/cron/rebuild-work-calendar) and the
// metrics-selfcheck self-heal run rebuildWorkCalendarInTx inside their runJob
// transaction; every successful write on the work-hours settings routes calls
// requestCalendarRebuild().
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
import { addMonths, businessDay, dayDiff } from "@/lib/time/civil";
import { loadWorkHoursSources } from "@/lib/workHours/load";
import { resolveRange } from "@/lib/workHours/resolveDay";
import { dbDateToString } from "@/lib/workHours/serialize";
import { workingWindows } from "@/lib/workHours/time";
import type { DateString, ResolvedDay } from "@/lib/workHours/types";
import { prisma, type TransactionClient } from "@/lib/db";
import { JOB_NAMES, lockKey, TX_OPTIONS } from "@/app/lib/jobs/jobRun";

/** Rolling horizon (§7.4): [-24 months, +12 months] around today. */
const HORIZON_MONTHS_BACK = 24;
const HORIZON_MONTHS_FORWARD = 12;

/**
 * "Horizon runs short" (§3.10 / §7.4): with fewer days left than this, a
 * rebuild publishes a new version even when the source digest is unchanged,
 * and the metrics-selfcheck self-heal builds the calendar in-process.
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
 * Rebuild (or verify) the versioned work calendar. Everything runs in ONE
 * interactive transaction on ONE connection — the TEMP stage table
 * (ON COMMIT DROP) is invisible to any other pool connection, so no statement
 * may escape the transaction (§3.5).
 *
 * A new work_calendar_version is created only when the source digest changed
 * or horizon_to is closer than CALENDAR_MIN_HORIZON_DAYS (§7.4); otherwise this is a
 * cheap read-only no-op. Overlapping runs (nightly cron vs. a settings save)
 * are serialized by a pg advisory xact lock — the loser skips healthily.
 */
async function rebuildWorkCalendar(client: PrismaClient): Promise<RebuildWorkCalendarResult> {
  return client.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey(JOB_NAMES.rebuildWorkCalendar)}, 0)) AS locked`;
    if (!locked) return { status: "skipped_overlap" as const };
    return rebuildWorkCalendarInTx(tx);
  }, TX_OPTIONS);
}

/**
 * The rebuild a work-hours settings write asks for (§7.4). Fire-and-forget:
 * the user's save never waits on, or fails with, the rebuild.
 */
export function requestCalendarRebuild(): void {
  rebuildWorkCalendar(prisma)
    .then((result) => {
      if (result.status === "skipped_overlap") {
        console.warn("work-calendar rebuild skipped: another rebuild holds the lock");
      }
    })
    .catch((err) => console.error("work-calendar rebuild failed", err));
}

/**
 * The rebuild itself, on a caller-owned transaction and WITHOUT the lock.
 *
 * Split out for the callers that already run inside runJob's transaction
 * (§10.1): the nightly job, whose runJob holds this job's advisory lock, and
 * the metrics-selfcheck job, whose §7.4 self-heal has to build the calendar
 * inside its own run. Calling rebuildWorkCalendar() from inside runJob would
 * open a SECOND transaction on a SECOND connection and then fail to take a lock
 * the first one already holds — every nightly rebuild would report a healthy
 * skip and the horizon would rot.
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
