import { rebuildWorkCalendarInTx, type RebuildWorkCalendarResult } from "@/app/lib/metrics/ledger/work-calendar";
import { JOB_NAMES, runJob } from "@/app/lib/jobs/jobRun";
import { cronRoute } from "../_lib/cron-route";

type CalendarDetail = Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>;

/**
 * POST /api/cron/rebuild-work-calendar — nightly at 01:00. Regenerates the
 * versioned work calendar over the rolling [-24, +12] month horizon (§3.5/§7.4);
 * the logic is in work-calendar.ts. runJob supplies the transaction, the
 * advisory lock (the same key a settings save takes) and the job_run row, which
 * is why the in-transaction variant is called here.
 *
 * `status` in the response is the CALENDAR outcome (rebuilt | noop |
 * skipped_overlap) — the seeder branches on it.
 */
export const POST = cronRoute({ schemaGate: false, failure: "Failed to rebuild work calendar" }, async () => {
  const outcome = await runJob<CalendarDetail>(JOB_NAMES.rebuildWorkCalendar, async (tx) => {
    const result = await rebuildWorkCalendarInTx(tx);
    return { rowsAffected: result.status === "rebuilt" ? result.spans : 0, detail: result };
  });
  // No detail: runJob lost the lock race and the calendar was not touched.
  const calendar: RebuildWorkCalendarResult = outcome.detail ?? { status: "skipped_overlap" };
  return Response.json({ success: true, jobRunId: outcome.jobRunId, ...calendar });
});
