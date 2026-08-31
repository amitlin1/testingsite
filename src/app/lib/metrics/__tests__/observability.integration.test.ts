// Stage-5 OBSERVABILITY suite (docs/dashboard-migration-plan-v2.md §10.1/§10.2):
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
// Two gates, two reasons:
//   TEST_DATABASE_URL — the job_run/runJob half, against a throwaway database.
//   TEST_APP_URL + AUTH_SECRET — the /api/health/jobs half. That route's gate is
//     withAuth INSIDE the handler, and withAuth calls Auth.js's auth(), which
//     reads the request scope through next/headers. There is no request scope in
//     a bare node:test process, so the only honest way to prove 401/403/200 is
//     over HTTP against a running server with a real, minted session cookie.
// Without them the describe blocks skip and plain `npm test` stays green.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, types } from "pg";
import { encode } from "next-auth/jwt";

// pg hands bigint (20) and numeric (1700) back as strings by default; every
// value this suite asserts on fits a JS number.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const TEST_APP_URL = (process.env.TEST_APP_URL ?? "").replace(/\/$/, "");
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";

function dbSkipReason(): string | false {
  return TEST_DATABASE_URL
    ? false
    : "TEST_DATABASE_URL is not set — stage-5 observability integration suite skipped";
}

function httpSkipReason(): string | false {
  if (!TEST_APP_URL) return "TEST_APP_URL is not set — /api/health/jobs auth suite skipped";
  if (!AUTH_SECRET) return "AUTH_SECRET is not set — cannot mint a session cookie, auth suite skipped";
  return false;
}

// ---------------------------------------------------------------------------
// job_run + runJob
// ---------------------------------------------------------------------------

describe("stage 5 — runJob and the job_run audit surface", { skip: dbSkipReason() }, () => {
  let pool: Pool;
  let jobRun: typeof import("../jobRun");
  let selfcheckRoute: { POST: (req: Request) => Promise<Response> };
  let prisma: { $disconnect: () => Promise<void> };

  type JobRunRow = {
    job_run_id: number;
    job_name: string;
    status: string;
    rows_affected: number | null;
    detail: any;
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

  /** The lock read-path/write-path hold for the life of their files while they
   *  truncate the ledger — and, in read-path's case, work_calendar_version.
   *  Same number on purpose. */
  const LEDGER_TRUNCATE_LOCK = 526050825;

  /** A job name no other run — or other suite — can collide with. */
  function uniqueJob(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  before(async () => {
    // MUST precede the dynamic imports: src/app/lib/prisma.ts builds its Pool
    // from process.env.DATABASE_URL at module-evaluation time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.CRON_SECRET = process.env.CRON_SECRET || "integration-suite-secret";

    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    jobRun = await import("../jobRun");
    selfcheckRoute = await import("../../../api/cron/metrics-selfcheck/route");
    prisma = (await import("../../prisma")).prisma as unknown as typeof prisma;
  });

  after(async () => {
    await prisma.$disconnect();
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
   *  own pool. Deliberately not imported from write-path-helpers: that copy
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
    assert.equal(body.checks.length, 12, "§3.10 — 11 checks plus intervals_negative_offhours");
    assert.ok(body.checks.some((c: any) => c.checkName === "calendar_horizon_days"));
    assert.equal(typeof body.reconciledIntervals, "number");
    assert.equal(typeof body.healthy, "boolean");

    const [row] = (await jobRuns("metrics-selfcheck")).filter(
      (r) => r.job_run_id === Number(body.jobRunId),
    );
    assert.ok(row, "the run must leave its job_run row behind");
    assert.equal(row.status, "ok");
    // rows_affected is the reconciliation — the only thing this job writes.
    assert.equal(row.rows_affected, body.reconciledIntervals);
    assert.equal(row.detail.checks.length, 12);
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
// GET /api/health/jobs — the self-gating the middleware cannot do
// ---------------------------------------------------------------------------

describe("stage 5 — GET /api/health/jobs is self-gated", { skip: httpSkipReason() }, () => {
  /**
   * A session cookie Auth.js will accept: the jwt callback returns the token
   * untouched while expires_at is comfortably in the future, so no Keycloak
   * round-trip happens and `roles` lands on the session as-is.
   */
  async function cookieFor(roles: string[]): Promise<string> {
    const jwt = await encode({
      token: {
        sub: "health-jobs-suite",
        name: "Health Jobs Suite",
        email: "suite@example.com",
        preferred_username: "suite",
        roles,
        expires_at: Date.now() + 3_600_000,
        refresh_expires_at: Date.now() + 7_200_000,
      },
      secret: AUTH_SECRET,
      salt: "authjs.session-token",
      maxAge: 3600,
    });
    return `authjs.session-token=${jwt}`;
  }

  function get(path: string, cookie?: string): Promise<Response> {
    return fetch(`${TEST_APP_URL}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
  }

  it("answers 401 with no session", async () => {
    const res = await get("/api/health/jobs");
    assert.equal(res.status, 401);
  });

  it("answers 403 for an authenticated non-manager", async () => {
    // THE DECISIVE CASE. `/api/health` is a PUBLIC_ROUTES prefix and
    // resolveAccess checks PUBLIC_ROUTES before ROLE_PROTECTED, so the
    // middleware waves this request through with its valid session. A 403 can
    // therefore only have come from the withAuth inside the handler.
    const res = await get("/api/health/jobs", await cookieFor(["tester"]));
    assert.equal(res.status, 403);
    assert.deepEqual((await res.json()).required, ["manager"]);
  });

  it("answers 200 with the job list and the full selfcheck for a manager", async () => {
    const res = await get("/api/health/jobs", await cookieFor(["manager"]));
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.deepEqual(
      body.jobs.map((j: any) => j.jobName).sort(),
      ["metrics-selfcheck", "rebuild-work-calendar", "release-stale-tests"],
      "§10.1 — three scheduled jobs, and one that has never run must still be listed",
    );
    for (const job of body.jobs) {
      assert.equal(typeof job.stale, "boolean");
      assert.equal(typeof job.intervalSeconds, "number");
    }
    assert.equal(body.checks.length, 12);
    assert.equal(typeof body.healthy, "boolean");
    assert.ok(Array.isArray(body.reasons));
  });

  it("leaves /api/health/schema public — 4-verify.ps1 has no session", async () => {
    const res = await get("/api/health/schema");
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json()).version, "number");
  });
});
