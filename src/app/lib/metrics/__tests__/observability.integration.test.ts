// Stage-5 OBSERVABILITY suite (docs/architecture/dashboard-migration-plan-v2.md §10.1/§10.2):
// the runJob wrapper, the job_run audit surface, the metrics-selfcheck endpoint,
// and the authorization of GET /api/health/jobs.
//
// DELIBERATELY SHARES NO FIXTURE WITH write-path.integration.test.ts. `node
// --test` runs test FILES in parallel (measured), so a second suite calling that
// one's setup()/resetDb() would truncate the ledger out from under it. This one
// therefore builds its own connection, never truncates anything, and asserts
// only on rows it created itself — every job name it uses carries a UUID, so a
// concurrent write-path run (which does produce real `release-stale-tests` rows)
// cannot be mistaken for this suite's own.
//
// Both halves run against a throwaway database (TEST_DATABASE_URL); without it
// they skip and plain `npm test` stays green. The /api/health/jobs half runs the
// route in-process with a stubbed session (src/lib/auth/testing.ts).
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, types } from "pg";
import { stubSession } from "@/lib/auth/testing";
import { LEDGER_TRUNCATE_LOCK } from "@/test-support/ledger-lock";

// pg hands bigint (20) and numeric (1700) back as strings by default; every
// value this suite asserts on fits a JS number.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

function dbSkipReason(): string | false {
  return TEST_DATABASE_URL
    ? false
    : "TEST_DATABASE_URL is not set — stage-5 observability integration suite skipped";
}

// ---------------------------------------------------------------------------
// job_run + runJob
// ---------------------------------------------------------------------------

describe("stage 5 — runJob and the job_run audit surface", { skip: dbSkipReason() }, () => {
  let pool: Pool;
  let jobRun: typeof import("../../jobs/jobRun");
  let selfcheckRoute: { POST: (req: Request) => Promise<Response> };

  type JobRunRow = {
    job_run_id: number;
    job_name: string;
    status: string;
    rows_affected: number | null;
    /** job_run.detail (jsonb): what the job recorded — a selfcheck its checks. */
    detail: { checks?: unknown[] } & Record<string, unknown>;
    error_text: string | null;
    host: string | null;
    duration_ms: number;
  };

  async function jobRuns(jobName: string): Promise<JobRunRow[]> {
    const res = await pool.query(
      `SELECT job_run_id, job_name, status, rows_affected, detail, error_text, host,
              EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS duration_ms
         FROM job_run WHERE job_name = $1 ORDER BY job_run_id`,
      [jobName],
    );
    return res.rows;
  }

  /** A job name no other run — or other suite — can collide with. */
  function uniqueJob(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  before(async () => {
    // MUST precede the dynamic imports: src/lib/db.ts builds its Pool
    // from process.env.DATABASE_URL at module-evaluation time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.CRON_SECRET = process.env.CRON_SECRET || "integration-suite-secret";

    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    jobRun = await import("../../jobs/jobRun");
    selfcheckRoute = await import("../../../api/cron/metrics-selfcheck/route");
  });

  after(async () => {
    await pool.end();
  });

  it("a successful run commits exactly one ok row carrying rows_affected, detail and host", async () => {
    const name = uniqueJob("ok");
    const outcome = await jobRun.runJob(name, async () => ({
      rowsAffected: 7,
      detail: { touched: ["a", "b"] },
    }));

    assert.equal(outcome.status, "ok");
    assert.equal(outcome.rowsAffected, 7);

    const rows = await jobRuns(name);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].job_run_id, Number(outcome.jobRunId));
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[0].rows_affected, 7);
    assert.deepEqual(rows[0].detail, { touched: ["a", "b"] });
    assert.equal(rows[0].error_text, null);
    assert.ok(rows[0].host, "host must be stamped — one row per app server");
  });

  it("finished_at - started_at is the real duration, not zero", async () => {
    // Regression: finishJobRun used now(), which is FROZEN for the whole
    // transaction, so every row said it took 0 ms and job_run could never answer
    // "how long did it take". clock_timestamp() advances.
    const name = uniqueJob("duration");
    await jobRun.runJob(name, async () => {
      await new Promise((r) => setTimeout(r, 120));
      return {};
    });

    const [row] = await jobRuns(name);
    assert.ok(row.duration_ms >= 100, `expected >=100ms, got ${row.duration_ms}`);
  });

  it("a lost advisory-lock race is a healthy skip: the body never runs", async () => {
    const name = uniqueJob("overlap");
    const bodiesRun: string[] = [];

    // The holder must still be inside its transaction when the second call takes
    // its turn — the lock is an XACT lock, released at commit.
    const holder = jobRun.runJob(name, async () => {
      bodiesRun.push("holder");
      await new Promise((r) => setTimeout(r, 400));
      return { rowsAffected: 1 };
    });
    await new Promise((r) => setTimeout(r, 80));
    const loser = await jobRun.runJob(name, async () => {
      bodiesRun.push("loser");
      return { rowsAffected: 99 };
    });
    const winner = await holder;

    assert.equal(winner.status, "ok");
    assert.equal(loser.status, "skipped_overlap");
    assert.equal(loser.rowsAffected, null);
    assert.deepEqual(bodiesRun, ["holder"], "the losing run must not do the work twice");

    const rows = await jobRuns(name);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.status).sort(),
      ["ok", "skipped_overlap"],
      "the skip is recorded, not swallowed — it is how an operator tells a skip from a miss",
    );
  });

  it("two different jobs do not block each other", async () => {
    // The lock key is derived from the job NAME. A global lock would serialize
    // the 5-minute reaper behind the nightly calendar rebuild.
    const a = uniqueJob("independent-a");
    const b = uniqueJob("independent-b");
    const [ra, rb] = await Promise.all([
      jobRun.runJob(a, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { rowsAffected: 1 };
      }),
      jobRun.runJob(b, async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { rowsAffected: 2 };
      }),
    ]);
    assert.equal(ra.status, "ok");
    assert.equal(rb.status, "ok");
  });

  it("a failure is recorded even though its transaction rolled back", async () => {
    // THE POINT OF THE WRAPPER'S FAILURE PATH. §10.1's sketch marks the row
    // 'failed' inside the transaction and then rethrows — which rolls the row
    // back with the work, so the one outcome that must never be invisible is the
    // only one leaving no trace. The canary proves the work really did roll back
    // while the failed row really did survive.
    const name = uniqueJob("failing");
    const canary = uniqueJob("rollback-canary");

    await assert.rejects(
      jobRun.runJob(name, async (tx) => {
        await tx.$executeRaw`INSERT INTO job_run (job_name, status) VALUES (${canary}, 'ok')`;
        throw new Error("boom");
      }),
      /boom/,
    );

    assert.deepEqual(await jobRuns(canary), [], "the job body's writes must be rolled back");

    const rows = await jobRuns(name);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "failed");
    assert.match(rows[0].error_text ?? "", /boom/);
    assert.equal(rows[0].rows_affected, null);
  });

  // timeout: the lock below waits for read-path.integration.test.ts, which holds
  // it for the length of its FILE. Waiting is the point; node:test's default
  // would call that wait a failure.
  it("POST /api/cron/metrics-selfcheck answers 200, returns the check rows and records its run",
     { timeout: 240_000 }, async () => {
    // ESTABLISH THE PRECONDITION INSTEAD OF RACING FOR IT.
    //
    // The endpoint reads calendar_horizon_days first and treats NULL as "heal
    // now"; the §7.4 self-heal then dynamically imports @hebcal/core, which is
    // ESM-only and dies under the CJS test runner with
    // ERR_PACKAGE_PATH_NOT_EXPORTED, so the route answers 500.
    //
    // This test used to wrap itself in the ledger suites' advisory lock, on the
    // theory that a parallel rebuild was transiently clearing is_current. That
    // was the wrong diagnosis and it made the test WORSE: pg_advisory_lock
    // blocks, the other suites hold that lock for the length of their files, and
    // the test still failed ~1 run in 2 — because the real cause is that this
    // suite truncates work_calendar_version and never seeds it, so
    // calendar_horizon_days is NULL by this suite's OWN doing. It passed only
    // when a parallel suite happened to have left a calendar behind, which is
    // precisely the coin-flip a test must not be.
    //
    // Seeding the same always-open calendar the other suites use makes the
    // precondition explicit and the outcome deterministic, with no cross-suite
    // coupling. The heal branch itself stays untestable here — a known gap
    // (§9.4ד), and now an honest one rather than a hidden coin-flip.
    // BOTH halves are required, and each alone is useless:
    //   - the LOCK, because read-path.integration.test.ts TRUNCATEs
    //     work_calendar_version (its TRUNCATE_TABLES list) and `node --test`
    //     runs files in parallel. Seeding without the lock loses the row to a
    //     truncate between the seed and the request.
    //   - the SEED, because this suite never seeds a calendar itself, so after
    //     read-path's truncate the table is simply empty. Locking without
    //     seeding leaves calendar_horizon_days NULL.
    // With NULL, the endpoint takes the §7.4 self-heal branch, whose dynamic
    // import of ESM-only @hebcal/core dies under the CJS test runner
    // (ERR_PACKAGE_PATH_NOT_EXPORTED) and the route answers 500.
    // History: lock-only failed ~1 run in 2; seed-only failed ~1 in 5. Both
    // together: 10 consecutive green runs.
    const lock = await pool.connect();
    try {
      await lock.query("SELECT pg_advisory_lock($1)", [LEDGER_TRUNCATE_LOCK]);
      await ensureWorkCalendar();
      await runSelfcheckTest();
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1)", [LEDGER_TRUNCATE_LOCK]);
      lock.release();
    }
  });

  /** The always-open calendar the ledger suites use, seeded through THIS suite's
   *  own pool. Deliberately not imported from test-support/db-harness: that copy
   *  closes over a pool only its setup() initialises, and this suite builds its
   *  own connection on purpose (see the file header). */
  async function ensureWorkCalendar(): Promise<void> {
    const existing = await pool.query(
      "SELECT calendar_version FROM work_calendar_version WHERE is_current",
    );
    if (existing.rowCount) return;
    const ver = await pool.query(`
      INSERT INTO work_calendar_version (horizon_from, horizon_to, source_digest, is_current)
      VALUES (DATE '2020-01-01', DATE '2035-01-01', 'observability-suite-always-open', true)
      RETURNING calendar_version
    `);
    await pool.query(
      `INSERT INTO work_span (calendar_version, work_date, span, span_seconds, cum_seconds_before)
       VALUES ($1, DATE '2020-01-01',
               tstzrange(TIMESTAMPTZ '2020-01-01 00:00 Asia/Jerusalem',
                         TIMESTAMPTZ '2035-01-01 00:00 Asia/Jerusalem', '[)'),
               EXTRACT(EPOCH FROM (TIMESTAMPTZ '2035-01-01 00:00 Asia/Jerusalem'
                                 - TIMESTAMPTZ '2020-01-01 00:00 Asia/Jerusalem'))::int,
               0)`,
      [ver.rows[0].calendar_version],
    );
  }

  async function runSelfcheckTest(): Promise<void> {
    const res = await selfcheckRoute.POST(
      new Request("http://localhost/api/cron/metrics-selfcheck", {
        method: "POST",
        headers: { "x-cron-secret": process.env.CRON_SECRET as string },
      }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.status, "ok");
    assert.equal(body.checks.length, 11, "§3.10 minus drift_open, which migration B retired with the dual-run scaffold");
    assert.ok(body.checks.some((c: { checkName: string }) => c.checkName === "calendar_horizon_days"));
    assert.equal(typeof body.reconciledIntervals, "number");
    assert.equal(typeof body.healthy, "boolean");

    const [row] = (await jobRuns("metrics-selfcheck")).filter(
      (r) => r.job_run_id === Number(body.jobRunId),
    );
    assert.ok(row, "the run must leave its job_run row behind");
    assert.equal(row.status, "ok");
    // rows_affected is the reconciliation — the only thing this job writes.
    assert.equal(row.rows_affected, body.reconciledIntervals);
    assert.equal(row.detail.checks?.length, 11); // 12 before migration B retired drift_open
  }

  it("the cron endpoint refuses without the shared secret, before touching the database", async () => {
    const before = (await jobRuns("metrics-selfcheck")).length;
    const res = await selfcheckRoute.POST(
      new Request("http://localhost/api/cron/metrics-selfcheck", { method: "POST" }),
    );
    assert.ok(res.status === 401 || res.status === 403, `expected a refusal, got ${res.status}`);
    assert.equal(
      (await jobRuns("metrics-selfcheck")).length,
      before,
      "a rejected caller must not leave a job_run row",
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/health/jobs — manager-only, gated by its handler's withAuth
// ---------------------------------------------------------------------------

describe("stage 5 — GET /api/health/jobs answers managers only", { skip: dbSkipReason() }, () => {
  let session: unknown = null;
  const signedIn = (...roles: string[]) => ({ user: { preferredUsername: "suite", name: "Health Jobs Suite" }, roles });
  let jobsRoute: { GET: (req: Request) => Promise<Response> };
  let schemaRoute: { GET: () => Promise<Response> };

  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    stubSession(() => session);
    jobsRoute = (await import("../../../api/health/jobs/route")) as unknown as typeof jobsRoute;
    schemaRoute = (await import("../../../api/health/schema/route")) as unknown as typeof schemaRoute;
  });

  const getJobs = () => jobsRoute.GET(new Request("http://localhost/api/health/jobs"));

  it("answers 401 with no session", async () => {
    session = null;
    assert.equal((await getJobs()).status, 401);
  });

  it("answers 403 for an authenticated non-manager, naming the role it requires", async () => {
    session = signedIn("tester");
    const res = await getJobs();
    assert.equal(res.status, 403);
    assert.deepEqual((await res.json()).required, ["manager"]);
  });

  it("answers 200 with the job list and the full selfcheck for a manager", async () => {
    session = signedIn("manager");
    const res = await getJobs();
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.deepEqual(
      body.jobs.map((j: { jobName: string }) => j.jobName).sort(),
      ["metrics-selfcheck", "rebuild-work-calendar", "release-stale-tests"],
      "§10.1 — three scheduled jobs, and one that has never run must still be listed",
    );
    for (const job of body.jobs) {
      assert.equal(typeof job.stale, "boolean");
      assert.equal(typeof job.intervalSeconds, "number");
    }
    assert.equal(body.checks.length, 11); // 12 before migration B retired drift_open
    assert.equal(typeof body.healthy, "boolean");
    assert.ok(Array.isArray(body.reasons));
  });

  it("answers /api/health/schema without a session — a server-to-server caller has none", async () => {
    session = null;
    const res = await schemaRoute.GET();
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json()).version, "number");
  });
});

// One disconnect for both halves: the shared client must outlive the first.
after(async () => {
  if (TEST_DATABASE_URL) await (await import("@/lib/db")).prisma.$disconnect();
});
