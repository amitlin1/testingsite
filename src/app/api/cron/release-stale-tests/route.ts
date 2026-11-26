import { releaseStaleTestsJob } from "@/app/lib/jobs/release-stale-tests";
import { cronRoute } from "../_lib/cron-route";

/**
 * POST /api/cron/release-stale-tests — run the abandoned-test release by hand.
 * Nothing outside the app calls it on a schedule any more: the app runs the
 * same job every 5 minutes itself (lib/jobs/stale-tests-timer.ts). The job and
 * why it exists: lib/jobs/release-stale-tests.ts. The seeder reads
 * releasedCount and stationsFreed off the top level.
 */
export const POST = cronRoute({ schemaGate: true, failure: "Failed to release stale tests" }, async () => {
  const outcome = await releaseStaleTestsJob();
  return Response.json({
    success: true,
    status: outcome.status,
    jobRunId: outcome.jobRunId,
    releasedCount: outcome.rowsAffected ?? 0,
    itemIds: outcome.detail?.itemIds ?? [],
    stationsFreed: outcome.detail?.stationsFreed ?? 0,
  });
});
