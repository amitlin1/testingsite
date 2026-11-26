import { syncWorkCalendarInTx, type RebuildWorkCalendarResult, type WorkCalendarSync } from "@/app/lib/metrics/ledger/work-calendar";
import { JOB_NAMES, runJob } from "@/app/lib/jobs/jobRun";
import { cronRoute } from "../_lib/cron-route";

/**
 * POST /api/cron/rebuild-work-calendar — a MANUAL operator tool: nothing
 * schedules it. The app keeps the calendar itself, at server start and after
 * every work-hours save (calendar-sync.ts). This runs the same job once: rebuild
 * if the sources changed, then recompute up to one batch of past intervals.
 *
 * `status` in the response is the CALENDAR outcome (rebuilt | noop |
 * skipped_overlap) — the seeder branches on it.
 */
export const POST = cronRoute({ schemaGate: false, failure: "Failed to rebuild work calendar" }, async () => {
  const outcome = await runJob<WorkCalendarSync>(JOB_NAMES.rebuildWorkCalendar, async (tx) => {
    const result = await syncWorkCalendarInTx(tx);
    return { rowsAffected: result.reconciledIntervals, detail: result };
  });
  // No detail: runJob lost the lock race and the calendar was not touched.
  const calendar: RebuildWorkCalendarResult = outcome.detail?.calendar ?? { status: "skipped_overlap" };
  return Response.json({
    success: true,
    jobRunId: outcome.jobRunId,
    ...calendar,
    reconciledIntervals: outcome.detail?.reconciledIntervals ?? 0,
  });
});
