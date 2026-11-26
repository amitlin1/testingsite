import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { errorResponse } from "@/lib/http/errors";
import { SCHEDULED_JOBS } from "@/app/lib/jobs/jobRun";
import {
  evaluateHealth,
  isStale,
  type JobHealthRow,
  type JobStatus,
  type JobsHealthPayload,
} from "@/app/lib/jobs/health";
import { runSelfcheck } from "@/app/lib/metrics/ledger/selfcheck";

const NO_STORE = { "Cache-Control": "no-store" };
// Never cached — a cached payload would keep reporting a job healthy after it
// stopped running, which is the one thing this endpoint exists to notice.
export const dynamic = "force-dynamic";

interface JobRunRow {
  job_name: string;
  last_success_at: Date | null;
  last_success_rows: bigint | null;
  seconds_since_success: bigint | null;
  last_run_at: Date | null;
  last_run_status: JobStatus | null;
  last_error_text: string | null;
}

/**
 * GET /api/health/jobs — the §10.2 observation surface: the last successful run
 * of every scheduled job, plus the full metrics_selfcheck().
 *
 * Manager-only (ACCESS.healthJobs, this handler's withAuth), matching
 * `/api/dashboard`: the payload names customers' items by count and exposes the
 * ledger's size and internal consistency. Unlike its siblings `/api/health` and
 * `/api/health/schema`, which are public (src/lib/routes.ts), it needs a session.
 */
export const GET = withAuth(
  async () => {
    try {
      const names = SCHEDULED_JOBS.map((j) => j.name);

      // Two LATERALs rather than one: the LAST run and the last SUCCESSFUL run
      // are different rows the moment a job starts failing, and that gap — "it
      // ran 4 minutes ago and it has not worked since Tuesday" — is the whole
      // diagnosis. Both ride the job_run_recent (job_name, started_at DESC)
      // index. unnest() drives the join so a job that has NEVER run still gets
      // a row, reported stale, instead of silently vanishing from the list.
      const rows = await prisma.$queryRaw<JobRunRow[]>`
        SELECT n.job_name,
               ok.finished_at   AS last_success_at,
               ok.rows_affected AS last_success_rows,
               EXTRACT(EPOCH FROM (now() - ok.finished_at))::bigint AS seconds_since_success,
               lr.started_at    AS last_run_at,
               lr.status        AS last_run_status,
               lr.error_text    AS last_error_text
          FROM unnest(${names}::text[]) AS n(job_name)
          LEFT JOIN LATERAL (
            SELECT j.finished_at, j.rows_affected
              FROM job_run j
             WHERE j.job_name = n.job_name AND j.status = 'ok'
             ORDER BY j.started_at DESC
             LIMIT 1
          ) ok ON true
          LEFT JOIN LATERAL (
            SELECT j.started_at, j.status, j.error_text
              FROM job_run j
             WHERE j.job_name = n.job_name
             ORDER BY j.started_at DESC
             LIMIT 1
          ) lr ON true`;

      const byName = new Map(rows.map((r) => [r.job_name, r]));
      const jobs: JobHealthRow[] = SCHEDULED_JOBS.map((job) => {
        const row = byName.get(job.name);
        const secondsSinceSuccess =
          row?.seconds_since_success == null ? null : Number(row.seconds_since_success);
        return {
          jobName: job.name,
          labelHe: job.labelHe,
          intervalSeconds: job.intervalSeconds,
          lastSuccessAt: row?.last_success_at?.toISOString() ?? null,
          secondsSinceSuccess,
          lastRunAt: row?.last_run_at?.toISOString() ?? null,
          lastRunStatus: row?.last_run_status ?? null,
          lastErrorText: row?.last_error_text ?? null,
          lastSuccessRows: row?.last_success_rows == null ? null : Number(row.last_success_rows),
          stale: isStale(job.intervalSeconds, secondsSinceSuccess),
        };
      });

      const checks = await runSelfcheck(prisma);
      const { healthy, reasons } = evaluateHealth(jobs, checks);

      const payload: JobsHealthPayload = {
        generatedAt: new Date().toISOString(),
        healthy,
        reasons,
        jobs,
        checks,
      };
      return Response.json(payload, { headers: NO_STORE });
    } catch (error) {
      // Unlike /api/health (pure liveness), this one MUST touch Postgres — an
      // unreachable DB is a 500, not a masked healthy 200.
      const res = errorResponse(error, "Failed to read job health");
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  },
  { perm: ACCESS.healthJobs },
);
