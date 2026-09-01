import { NextResponse } from "next/server";
import { cronSecretGuard } from "@/lib/auth/cron-secret";
import { rebuildWorkCalendarInTx, type RebuildWorkCalendarResult } from "@/lib/work-calendar";
import { runJob } from "@/app/lib/metrics/jobRun";

export const runtime = "nodejs";

type CalendarDetail = Exclude<RebuildWorkCalendarResult, { status: "skipped_overlap" }>;

/**
 * POST /api/cron/rebuild-work-calendar
 *
 * Regenerates the versioned work calendar (work_calendar_version + work_span)
 * over the rolling [-24 months, +12 months] horizon — plan §3.5/§7.4. Runs
 * nightly at 01:00 from the Windows Task Scheduler, and the same shared
 * function fires after every write on the work-hours settings screen.
 *
 * Thin shell by design: all logic — the TEMP stage table ON COMMIT DROP,
 * work_calendar_build, the is_current flip and the source-digest no-op — lives
 * in src/lib/work-calendar.ts. runJob (§10.1) supplies what used to be the
 * function's own scaffolding: the single transaction, the advisory xact lock on
 * the SAME `job:rebuild-work-calendar` key, and the job_run audit row. That is
 * why the in-transaction variant is called here — rebuildWorkCalendar() would
 * open a second transaction inside runJob's and then lose the lock to it.
 *
 * The response keeps the pre-runJob shape: `status` is the CALENDAR outcome
 * (rebuilt | noop | skipped_overlap), which the seeder branches on. An overlap
 * skip is still HTTP 200 — the Task Scheduler's curl --fail would paint any
 * non-2xx as a job failure (§10.1).
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;

  try {
    const outcome = await runJob<CalendarDetail>("rebuild-work-calendar", async (tx) => {
      const result = await rebuildWorkCalendarInTx(tx);
      return {
        rowsAffected: result.status === "rebuilt" ? result.spans : 0,
        detail: result,
      };
    });

    // No detail means runJob itself lost the race — the calendar was not touched,
    // which is exactly what the old in-function skip reported.
    const calendar: RebuildWorkCalendarResult = outcome.detail ?? { status: "skipped_overlap" };
    return NextResponse.json({ success: true, jobRunId: outcome.jobRunId, ...calendar });
  } catch (error: any) {
    console.error("Error rebuilding work calendar:", error);
    return NextResponse.json(
      { error: "Failed to rebuild work calendar", message: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
