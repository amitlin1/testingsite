import { NextResponse } from "next/server";
import { cronSecretGuard } from "@/lib/auth/cron-secret";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { runJob } from "@/app/lib/metrics/jobRun";
import {
  evaluateHealth,
  runSelfcheck,
  selfcheckAnomalies,
  selfcheckValue,
  type SelfcheckRow,
} from "@/app/lib/metrics/selfcheck";
import type { RebuildWorkCalendarResult } from "@/lib/work-calendar";
import type { TransactionClient } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * §7.4 self-heal trigger. Deliberately 60 and not the tile's 30: the job must
 * fix the horizon a month BEFORE the tile would have to shout about it, and it
 * is the same threshold work-calendar.ts uses for "the horizon runs short".
 */
const HEAL_HORIZON_DAYS = 60;

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
 * The §7.4 self-heal, behind a DYNAMIC import on purpose.
 *
 * It is a cold path — the 01:00 job keeps the horizon long, so this fires only
 * on the night that job did not run — and a static import would drag the whole
 * calendar builder, @hebcal/core included, into the module graph of a route that
 * almost never calls it. @hebcal/core is ESM-only (no "require" condition), so
 * that static edge also makes this route unloadable from the node:test runner,
 * which transpiles to CJS: the integration suite could not drive the endpoint at
 * all. Deferring the import costs one resolution on the rare heal.
 */
async function healCalendar(
  tx: TransactionClient,
): Promise<Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>> {
  const { rebuildWorkCalendarInTx } = await import("@/lib/work-calendar");
  return rebuildWorkCalendarInTx(tx);
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
 * POST /api/cron/metrics-selfcheck
 *
 * The third scheduled job of §10.1 — daily at 02:00, an hour after the calendar
 * rebuild. Three things in one transaction, in this order:
 *
 *   1. SELF-HEAL (§7.4). calendar_horizon_days < 60 (or no current version at
 *      all) ⇒ build the calendar in-process, before anything else reads it.
 *      Normally a no-op: the 01:00 job keeps the horizon long. This is the
 *      backstop for the night that job did not run.
 *   2. RECONCILE (§7.4). Recompute the closed intervals a newer calendar version
 *      has invalidated — including the ones step 1 just invalidated.
 *   3. CHECK (§3.10). Run metrics_selfcheck() and record the verdict. The checks
 *      run AFTER the healing so job_run.detail describes the state the job
 *      leaves behind, not the one it found; `before` is kept only to decide
 *      whether step 1 was needed.
 *
 * The response carries the check rows so an operator can `curl` this endpoint
 * and read the same 12 numbers `SELECT * FROM metrics_selfcheck()` prints. A
 * RED verdict is still HTTP 200 with `healthy:false` — the job did its work; the
 * .bat's curl --fail must report a broken JOB, not a dirty database, or the one
 * signal the factory has stops meaning anything.
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;

  // The self-heal builds a calendar version and rewrites ledger columns — same
  // refuse-to-serve gate every metrics writer carries (§8 stage 3).
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const outcome = await runJob<SelfcheckDetail>("metrics-selfcheck", async (tx) => {
      const before = await runSelfcheck(tx);
      const horizon = selfcheckValue(before, "calendar_horizon_days");

      const calendar =
        horizon === null || horizon < HEAL_HORIZON_DAYS ? await healCalendar(tx) : null;

      const reconciledIntervals = await reconcileStaleCalendar(tx);

      const checks = calendar || reconciledIntervals > 0 ? await runSelfcheck(tx) : before;
      // No job rows here: whether the OTHER jobs are late is /api/health/jobs's
      // question, and a job cannot meaningfully grade its own freshness from
      // inside its own run.
      const { healthy, reasons } = evaluateHealth([], checks);

      return {
        // The reconciliation is the only thing this job WRITES to the ledger.
        rowsAffected: reconciledIntervals,
        detail: { calendar, reconciledIntervals, healthy, reasons, checks },
      };
    });

    const detail = outcome.detail;
    return NextResponse.json({
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
  } catch (error: any) {
    console.error("Error running metrics selfcheck:", error);
    return NextResponse.json(
      { error: "Failed to run metrics selfcheck", message: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
