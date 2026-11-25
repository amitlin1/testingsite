import type { TransactionClient } from "@/lib/db";
import { JOB_NAMES, runJob } from "@/app/lib/jobs/jobRun";
import { evaluateHealth, selfcheckAnomalies, selfcheckValue, type SelfcheckRow } from "@/app/lib/jobs/health";
import { runSelfcheck } from "@/app/lib/metrics/ledger/selfcheck";
import {
  CALENDAR_MIN_HORIZON_DAYS,
  rebuildWorkCalendarInTx,
  type RebuildWorkCalendarResult,
} from "@/app/lib/metrics/ledger/work-calendar";
import { cronRoute } from "../_lib/cron-route";

/**
 * Rows reconciled per run. Measured on the seeded dev dataset: the
 * work_seconds_between expression over 5,796 closed intervals costs 2.38 s
 * (~0.41 ms a row), and a whole run of this endpoint — calendar rebuild plus a
 * reconciliation of all 5,798 intervals — took 3.5–3.7 s. 50k rows is therefore
 * ~20 s, comfortably inside runJob's 240 s budget with the rebuild in front of
 * it. Anything left over is reported by intervals_stale_calendar and picked up
 * tomorrow.
 */
const RECONCILE_BATCH_ROWS = 50_000;

interface SelfcheckDetail {
  calendar: RebuildWorkCalendarResult | null;
  reconciledIntervals: number;
  healthy: boolean;
  reasons: string[];
  checks: SelfcheckRow[];
}

/**
 * Recompute work_seconds for closed intervals still stamped with a superseded
 * calendar_version — the reconciliation of §7.4, which `intervals_stale_calendar`
 * exists to track ("what has not been recomputed yet"). A holiday entered late,
 * or 15:30 corrected to 15:35, changes past numbers by design; without this the
 * ledger would keep reporting the pre-correction durations forever.
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
async function reconcileStaleCalendar(tx: TransactionClient): Promise<number> {
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

/**
 * POST /api/cron/metrics-selfcheck — daily at 02:00, an hour after the calendar
 * rebuild. Three things in one transaction, in this order:
 *
 *   1. SELF-HEAL (§7.4). A calendar horizon under CALENDAR_MIN_HORIZON_DAYS (or
 *      no current version at all) ⇒ build the calendar in-process, before
 *      anything else reads it — the backstop for a night the 01:00 job did not
 *      run, a month before the tile would have to shout about it.
 *   2. RECONCILE (§7.4). Recompute the closed intervals a newer calendar version
 *      has invalidated — including the ones step 1 just invalidated.
 *   3. CHECK (§3.10). Run metrics_selfcheck() and record the verdict, AFTER the
 *      healing, so job_run.detail describes the state the job leaves behind.
 *
 * The response carries the check rows, so an operator can `curl` this endpoint
 * and read what `SELECT * FROM metrics_selfcheck()` prints. A RED verdict is
 * still HTTP 200 with `healthy:false`: the job did its work.
 */
export const POST = cronRoute({ schemaGate: true, failure: "Failed to run metrics selfcheck" }, async () => {
  const outcome = await runJob<SelfcheckDetail>(JOB_NAMES.metricsSelfcheck, async (tx) => {
    const before = await runSelfcheck(tx);
    const horizon = selfcheckValue(before, "calendar_horizon_days");
    const calendar =
      horizon === null || horizon < CALENDAR_MIN_HORIZON_DAYS ? await rebuildWorkCalendarInTx(tx) : null;
    const reconciledIntervals = await reconcileStaleCalendar(tx);
    const checks = calendar || reconciledIntervals > 0 ? await runSelfcheck(tx) : before;
    // No job rows: whether the OTHER jobs are late is /api/health/jobs's
    // question, and a job cannot grade its own freshness from inside its run.
    const { healthy, reasons } = evaluateHealth([], checks);
    return {
      rowsAffected: reconciledIntervals,
      detail: { calendar, reconciledIntervals, healthy, reasons, checks },
    };
  });

  const detail = outcome.detail;
  return Response.json({
    success: true,
    status: outcome.status,
    jobRunId: outcome.jobRunId,
    calendar: detail?.calendar ?? null,
    reconciledIntervals: detail?.reconciledIntervals ?? 0,
    healthy: detail?.healthy ?? null,
    reasons: detail?.reasons ?? [],
    anomalies: detail ? selfcheckAnomalies(detail.checks) : [],
    checks: detail?.checks ?? [],
  });
});
