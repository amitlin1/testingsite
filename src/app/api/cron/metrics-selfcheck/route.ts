import { selfcheckAnomalies } from "@/app/lib/jobs/health";
import { runMetricsSelfcheckJob } from "@/app/lib/metrics/ledger/selfcheck-job";
import { cronRoute } from "../_lib/cron-route";

/**
 * POST /api/cron/metrics-selfcheck — a MANUAL operator tool (nothing schedules
 * it; the app keeps the work calendar itself, calendar-sync.ts): heal a short
 * calendar horizon, reconcile one batch of intervals a newer calendar
 * invalidated, record metrics_selfcheck(). The job body is in selfcheck-job.ts.
 *
 * The response carries the check rows, so an operator can `curl` this endpoint
 * and read what `SELECT * FROM metrics_selfcheck()` prints. A RED verdict is
 * still HTTP 200 with `healthy:false`: the job did its work.
 */
export const POST = cronRoute({ schemaGate: true, failure: "Failed to run metrics selfcheck" }, async () => {
  const outcome = await runMetricsSelfcheckJob();
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
