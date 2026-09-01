// The scheduled-job wrapper (plan §10.1) and the `job_run` audit surface (§3.9).
//
// There is no Prometheus, no Grafana and no alerting channel on the isolated
// LAN (§10.2). `job_run` inside Postgres IS the observability surface: durable,
// queryable, and carried out of the building for free by the nightly dump. Every
// scheduled endpoint therefore goes through runJob(), and every run — ok, failed
// or healthily skipped — leaves exactly one row behind.

import { hostname } from "node:os";
import type { Prisma } from "@prisma/client";
import { prisma, type TransactionClient } from "@/app/lib/prisma";

export type JobStatus = "running" | "ok" | "failed" | "skipped_overlap";

/**
 * The three scheduled jobs of §10.1, with the period 8-register-tasks.ps1
 * actually registers them at. `intervalSeconds` is not decoration: it is the
 * ×2 in the §10.2 staleness rule, so this table and the Task Scheduler
 * registration must be changed together.
 */
export const SCHEDULED_JOBS: ReadonlyArray<{
  name: string;
  labelHe: string;
  intervalSeconds: number;
}> = [
  { name: "release-stale-tests", labelHe: "שחרור בדיקות תקועות", intervalSeconds: 5 * 60 },
  { name: "rebuild-work-calendar", labelHe: "בניית לוח שעות עבודה", intervalSeconds: 24 * 60 * 60 },
  { name: "metrics-selfcheck", labelHe: "בדיקת תקינות מטריקות", intervalSeconds: 24 * 60 * 60 },
];

/** What a job body reports about the work it did. */
export interface JobResult<D extends object = object> {
  /** Business rows the run touched — job_run.rows_affected. */
  rowsAffected?: number | null;
  /** Free-form audit payload — job_run.detail. Must be JSON-serializable. */
  detail?: D | null;
}

export type JobOutcome<D extends object = object> =
  | { status: "ok"; jobRunId: string; rowsAffected: number | null; detail: D | null }
  | { status: "skipped_overlap"; jobRunId: string; rowsAffected: null; detail: null };

/**
 * Transaction budget. Matches rebuildWorkCalendar's — the calendar rebuild is
 * the longest thing any of these jobs does, and the selfcheck can run it
 * in-process as its self-heal step (§7.4).
 */
const TX_OPTIONS = { timeout: 240_000, maxWait: 5_000 } as const;

/**
 * Postgres error messages can carry a whole failing statement. job_run rows are
 * read by an operator in a terminal, and the nightly dump carries them off-site;
 * a megabyte of stack per failed run helps nobody.
 */
const ERROR_TEXT_LIMIT = 4000;

/** The lock key §10.1 names, and the one src/lib/work-calendar.ts already uses. */
function lockKey(jobName: string): string {
  return `job:${jobName}`;
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > ERROR_TEXT_LIMIT ? `${text.slice(0, ERROR_TEXT_LIMIT)}…[truncated]` : text;
}

/**
 * §10.2 item 5 — one structured JSON line per run. It is also the raw material
 * for the §6.4 p95 measurement, so the field names are fixed: job, run_id,
 * duration_ms, rows.
 */
function logJobRun(fields: {
  job: string;
  run_id: string | null;
  status: JobStatus;
  duration_ms: number;
  rows: number | null;
  error?: string;
}): void {
  console.log(JSON.stringify({ evt: "job_run", ...fields }));
}

/**
 * Write ONE complete job_run row on the given client.
 *
 * `durationMs` is a measured elapsed time, not a clock reading: started_at is
 * derived from the database's own now() so the audit trail stays on the DB clock
 * (§7.5), while Node contributes only the interval it timed. now() rather than
 * clock_timestamp() precisely because it is frozen — both ends of the row are
 * anchored to the same instant, so finished_at - started_at is exactly
 * durationMs.
 */
export async function recordJobRun(
  client: TransactionClient | typeof prisma,
  args: {
    jobName: string;
    status: Exclude<JobStatus, "running">;
    durationMs: number;
    rowsAffected?: number | null;
    detail?: object | null;
    errorText?: string | null;
  },
): Promise<string> {
  const rows = await client.$queryRaw<{ job_run_id: bigint }[]>`
    INSERT INTO job_run (job_name, started_at, finished_at, status, rows_affected, detail, error_text, host)
    VALUES (${args.jobName},
            now() - (${args.durationMs}::numeric * interval '1 millisecond'),
            now(),
            ${args.status},
            ${args.rowsAffected ?? null},
            ${(args.detail ?? null) as Prisma.InputJsonValue | null}::jsonb,
            ${args.errorText ?? null},
            ${hostname()})
    RETURNING job_run_id`;
  return rows[0].job_run_id.toString();
}

async function startJobRun(tx: TransactionClient, jobName: string): Promise<string> {
  const rows = await tx.$queryRaw<{ job_run_id: bigint }[]>`
    INSERT INTO job_run (job_name, status, host) VALUES (${jobName}, 'running', ${hostname()})
    RETURNING job_run_id`;
  return rows[0].job_run_id.toString();
}

async function finishJobRun(
  tx: TransactionClient,
  jobRunId: string,
  status: Exclude<JobStatus, "running">,
  result?: JobResult<object> | null,
): Promise<void> {
  // clock_timestamp(), not now(): now() is the TRANSACTION timestamp and is
  // frozen for the whole run, so finished_at would equal started_at on every row
  // and job_run could never answer "how long did it take". clock_timestamp()
  // advances, making finished_at - started_at the real in-transaction duration.
  await tx.$executeRaw`
    UPDATE job_run
       SET finished_at = clock_timestamp(), status = ${status},
           rows_affected = ${result?.rowsAffected ?? null},
           detail = ${(result?.detail ?? null) as Prisma.InputJsonValue | null}::jsonb
     WHERE job_run_id = ${BigInt(jobRunId)}`;
}

/**
 * Run one scheduled job under the §10.1 contract.
 *
 * ONE transaction, always. pg_try_advisory_xact_lock releases at its end, and a
 * lock taken outside a transaction would be a no-op: Prisma over a plain Pool
 * autocommits every statement that is not inside $transaction, so the session
 * that took the lock is handed straight back to the pool.
 *
 * A LOST RACE IS NOT AN ERROR. The overlapping run returns status
 * "skipped_overlap" and the caller answers HTTP 200 — the .bat files use
 * `curl --fail`, so a 409 would show up in Task Scheduler as a failed task and
 * burn the only operational signal the factory has on a perfectly healthy no-op.
 *
 * A FAILURE IS RECORDED OUTSIDE THE TRANSACTION. Marking the row 'failed' inside
 * it and then rethrowing would roll that row back together with the work — the
 * one outcome that must never be invisible would be the only one leaving no
 * trace. The failed row is therefore written afterwards on the base client,
 * which is also why job_run carries no FK into anything a job touches.
 *
 * The 'running' row is not externally observable (it commits already finished);
 * that is inherent in the single-transaction rule and is fine — job_run answers
 * "when did this last succeed", not "is it running right now".
 */
export async function runJob<D extends object = object>(
  jobName: string,
  fn: (tx: TransactionClient) => Promise<JobResult<D> | void>,
): Promise<JobOutcome<D>> {
  const startedAtMs = Date.now();
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey(jobName)}, 0)) AS locked`;
      const jobRunId = await startJobRun(tx, jobName);

      if (!locked) {
        await finishJobRun(tx, jobRunId, "skipped_overlap");
        return { status: "skipped_overlap" as const, jobRunId, rowsAffected: null, detail: null };
      }

      const result = (await fn(tx)) ?? {};
      await finishJobRun(tx, jobRunId, "ok", result);
      return {
        status: "ok" as const,
        jobRunId,
        rowsAffected: result.rowsAffected ?? null,
        detail: result.detail ?? null,
      };
    }, TX_OPTIONS);

    logJobRun({
      job: jobName,
      run_id: outcome.jobRunId,
      status: outcome.status,
      duration_ms: Date.now() - startedAtMs,
      rows: outcome.rowsAffected,
    });
    return outcome as JobOutcome<D>;
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const text = errorText(error);
    let jobRunId: string | null = null;
    try {
      jobRunId = await recordJobRun(prisma, {
        jobName,
        status: "failed",
        durationMs,
        errorText: text,
      });
    } catch (recordError) {
      // The DB is the audit surface; when it cannot even take the failure row,
      // the job's own error is still the one worth propagating.
      console.error(`[jobRun] could not record the failure of ${jobName}:`, recordError);
    }
    logJobRun({
      job: jobName,
      run_id: jobRunId,
      status: "failed",
      duration_ms: durationMs,
      rows: null,
      error: text,
    });
    throw error;
  }
}
