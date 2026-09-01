import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { SCHEDULED_JOBS, type JobStatus } from "@/app/lib/metrics/jobRun";
import {
  evaluateHealth,
  runSelfcheck,
  type JobHealthRow,
  type JobsHealthPayload,
} from "@/app/lib/metrics/selfcheck";

export const runtime = "nodejs";
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
 * SELF-GATED, and it has to be. This route sits under the `/api/health` prefix,
 * which is in PUBLIC_ROUTES (the docker healthcheck and the nginx upstream have
 * no session cookie, and a gated liveness probe answers 401 → container marked
 * unhealthy → nginx never starts). resolveAccess checks PUBLIC_ROUTES BEFORE
 * ROLE_PROTECTED and prefix-matches, so `/api/health/jobs` is public to the
 * middleware no matter what is added to ROLE_PROTECTED — the only gate that can
 * work here is this withAuth in the handler. Its sibling
 * `/api/health/schema` stays public deliberately: 4-verify.ps1 calls it
 * server-to-server with no session, and it leaks only a schema number.
 *
 * Manager-only, matching `/api/dashboard`: the payload names customers' items by
 * count and exposes the ledger's size and internal consistency.
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
          // §10.2: now() - last_success > interval × 2. Never-succeeded is the
          // worse case, not an exemption from the rule.
          stale: secondsSinceSuccess === null || secondsSinceSuccess > job.intervalSeconds * 2,
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
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    } catch (error: any) {
      // Unlike /api/health (pure liveness), this one MUST touch Postgres — an
      // unreachable DB is a 500, not a masked healthy 200.
      console.error("Error reading job health:", error);
      return NextResponse.json(
        { error: "Failed to read job health", message: error.message || "Unknown error" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
  },
  { role: "manager" },
);
