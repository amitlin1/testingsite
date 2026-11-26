// The metrics-selfcheck job body — heal a short calendar, reconcile, record
// metrics_selfcheck() — behind POST /api/cron/metrics-selfcheck, a manual
// operator tool since 2026-11-26 (nothing schedules it: the calendar is kept
// by calendar-sync.ts inside the app).

import { JOB_NAMES, runJob, type JobOutcome } from "@/app/lib/jobs/jobRun";
import { evaluateHealth, selfcheckValue, type SelfcheckRow } from "@/app/lib/jobs/health";
import { runSelfcheck } from "./selfcheck";
import {
  CALENDAR_MIN_HORIZON_DAYS,
  rebuildWorkCalendarInTx,
  reconcileStaleCalendar,
  type RebuildWorkCalendarResult,
} from "./work-calendar";

export interface SelfcheckDetail {
  calendar: RebuildWorkCalendarResult | null;
  reconciledIntervals: number;
  healthy: boolean;
  reasons: string[];
  checks: SelfcheckRow[];
}

/**
 * Three things in one transaction, in this order:
 *
 *   1. SELF-HEAL (§7.4). A calendar horizon under CALENDAR_MIN_HORIZON_DAYS (or
 *      no current version at all) ⇒ build the calendar in-process, before
 *      anything else reads it.
 *   2. RECONCILE (§7.4). Recompute the closed intervals a newer calendar version
 *      has invalidated — including the ones step 1 just invalidated.
 *   3. CHECK (§3.10). Run metrics_selfcheck() and record the verdict, AFTER the
 *      healing, so job_run.detail describes the state the job leaves behind.
 */
export function runMetricsSelfcheckJob(): Promise<JobOutcome<SelfcheckDetail>> {
  return runJob<SelfcheckDetail>(JOB_NAMES.metricsSelfcheck, async (tx) => {
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
}
