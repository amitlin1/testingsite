// Stage-6 ENTITY-HISTORY suite (docs/dashboard-migration-plan-v2.md §5.3 Q2א /
// Q2ב, §5.0 the cross-cutting rules, §2.8 the two clocks, §3.1 unmapped, §8
// stage 6).
//
// WHY IT EXISTS. Stage 6 moved six history screens off the snapshot tables and
// onto the ledger, and shipped with zero tests: src/app/lib/metrics/entity-history.ts
// was 147 uncovered lines, the four `[id]/history` routes were absent from the
// parity matrix (which only knows path-less endpoints), and the weekly fold that
// decides what the dialogs actually DRAW lived four times over inside four .tsx
// files where nothing could reach it. That is precisely the gap that let stage 5
// ship four structurally-null fields: the harness passed them because nothing
// asserted them.
//
// WHAT IT COVERS, in the order the data flows:
//
//   1. THE FOLD (pure, runs with no database). mean vs sum vs last vs the
//      null-preserving weighted average, and the one that matters: a week
//      containing a gap stays NULL rather than collapsing to 0 (§5.0(7)).
//   2. entityHistory() over a deterministic ledger: the state mapping, the
//      §3.1 `unmapped` slice surviving as a visible series, the `_new_<key>`
//      fallback for a state_key metric_state grows and the map does not know,
//      `_new_activeTotal` as the sum of its own row, and the cumulative line
//      checked against a DIRECT count over route_run — not against a second
//      copy of the JavaScript.
//   3. NO GAP FILL. The fixture has a genuinely empty day between two busy
//      ones. The counts come back as measured zeros and the durations as
//      nulls; neither repeats the day before (§5.0(7)).
//   4. THE FOUR ROUTES, end to end, by invoking the exported handlers — the
//      13-month cap and its headers, both clocks on every duration, an entity
//      with no data answering the same envelope zero-filled with HTTP 200, and
//      the stage-5 assertion: no `_new_` field null across every row.
//
// HOW THE ROUTES ARE REACHED, and why the fixture is the ledger's own fold, is
// identical to read-path.integration.test.ts — the auth module is seeded into
// require.cache before withAuth resolves it, and every interval here is written
// by trg_isi_apply from real events rather than INSERTed by hand. The one
// addition is Next's route context: these four handlers are dynamic, so they are
// called as the framework calls them, with `{ params: Promise<{id}> }`.
//
// The work calendar is 08:00-16:00 every day, so the work clock is arithmetic a
// reader can check; the fixture's one overnight wait is the row that proves the
// two clocks are two different numbers and not one column printed twice.
//
// SERIALISATION. This file TRUNCATEs the ledger and adds a row to
// `metric_state`, so it takes the same session-level advisory lock
// read-path.integration.test.ts and write-path.integration.test.ts take, for the
// life of the file, and it removes its metric_state row before releasing it.
//
// The DB half runs ONLY when TEST_DATABASE_URL points at a throwaway database
// carrying migration 20260825000000_metrics_ledger_additive. Without it those
// describe blocks skip and plain `npm test` stays green; the fold block above
// touches nothing and always runs.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool, types } from "pg";

import {
  UI_MONTH_CAP,
  addDays,
  addMonths,
  daysBetween,
  resolvePeriod,
  todayBusinessDay,
} from "../period";
import { entityHistory, type EntityHistoryPoint } from "../entity-history";
import type { MetricsClient } from "../queries";
import {
  aggregateEntityHistoryWeekly,
  aggregateStationHistoryWeekly,
  lastOf,
  meanOf,
  sumOf,
  weekStartOf,
  weightedMeanOf,
} from "../history-fold";

types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

function skipReason(): string | false {
  return TEST_DATABASE_URL
    ? false
    : "TEST_DATABASE_URL is not set — stage-6 entity-history integration suite skipped";
}

// ===========================================================================
// 1. THE WEEKLY FOLD — pure, and the only part of stage 6 the user SEES
// ===========================================================================

describe("stage 6 — the weekly fold the dialogs draw (§5.3, §5.0(7), §2.8)", () => {
  /** A Sunday..Saturday week, plus the first day of the next one. */
  const W1 = ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
  const W2 = "2026-08-23";

  it("weeks start on Sunday and are civil-date arithmetic, not a Date in the process timezone", () => {
    // 2026-08-16 IS a Sunday, so it is its own week start; every day of that
    // week folds onto it, and the next Sunday opens a new bucket.
    for (const d of W1) assert.equal(weekStartOf(d), "2026-08-16", d);
    assert.equal(weekStartOf(W2), "2026-08-23");
    // A full ISO instant reduces to its civil day first.
    assert.equal(weekStartOf("2026-08-19T21:00:00.000Z"), "2026-08-16");
    // Across a month and a year boundary, and across both Israeli DST switches
    // — the arithmetic never adds 24-hour steps, so none of them can shift it.
    assert.equal(weekStartOf("2026-03-01"), "2026-03-01");
    assert.equal(weekStartOf("2026-03-28"), "2026-03-22"); // DST started 03-27
    assert.equal(weekStartOf("2026-10-26"), "2026-10-25"); // DST ended 10-25
    assert.equal(weekStartOf("2027-01-01"), "2026-12-27");
  });

  it("mean, sum and last are three different answers, and each column gets its own", () => {
    // A standing population of 2 that never moved, one closure a day, and a
    // cumulative total that walks 10 -> 17.
    const daily = W1.map((date, i) => ({
      date,
      itemsInQueue: 2,
      itemsInTest: i, // 0..6, mean 3
      itemsWaitingForResearch: 0,
      itemsInResearch: 0,
      _new_unmapped: 1,
      finishedItems: 10 + i + 1, // 11..17, cumulative
      _new_finishedToday: 1,
    }));

    const [w] = aggregateEntityHistoryWeekly(daily, "finishedItems");
    assert.equal(w.date, "2026-08-16");
    // MEAN — a point-in-time count. Two items that stood still all week are
    // two items, never fourteen.
    assert.equal(w.itemsInQueue, 2);
    assert.equal(w.itemsInTest, 3);
    assert.equal(w._new_unmapped, 1);
    // LAST — a cumulative series is summarised by where it ENDED. Its mean
    // (14) is the middle of the week wearing the label of the end of it, and
    // its sum (98) is meaningless.
    assert.equal(w.finishedItems, 17);
    assert.notEqual(w.finishedItems, meanOf(daily, "finishedItems"));
    assert.notEqual(w.finishedItems, sumOf(daily, "finishedItems"));
    // SUM — the additive twin of the cumulative line.
    assert.equal(w._new_finishedToday, 7);
    // And the two agree: the week's closures are the rise of the total.
    assert.equal(Number(w.finishedItems) - 10, w._new_finishedToday);
  });

  it("the item-type / shipment dialogs fold the SAME series under their own wire name", () => {
    const daily = W1.map((date) => ({ date, itemsFinished: 4, _new_finishedToday: 0 }));
    const [w] = aggregateEntityHistoryWeekly(daily, "itemsFinished");
    assert.equal(w.itemsFinished, 4);
    assert.equal("finishedItems" in w, false);
  });

  it("two weeks stay two rows, in ascending order, whatever order they arrive in", () => {
    const daily = [...W1, W2].reverse().map((date) => ({ date, itemsInQueue: 1, finishedItems: 1 }));
    const weeks = aggregateEntityHistoryWeekly(daily, "finishedItems");
    assert.deepEqual(weeks.map((w) => w.date), ["2026-08-16", "2026-08-23"]);
  });

  // -------------------------------------------------------------------------
  // The station fold: the null-preserving weighted average (§2.8, §5.0(7))
  // -------------------------------------------------------------------------

  it("durations are weighted by their sample count — a 30-closure day outweighs a 1-closure day", () => {
    const daily = [
      { date: "2026-08-16", _new_waitSamples: 1, _new_waitWallMin: 100, _new_waitWorkMin: 50, _new_handleSamples: 0, _new_handleWallMin: null, _new_handleWorkMin: null, totalProcessed: 1 },
      { date: "2026-08-17", _new_waitSamples: 3, _new_waitWallMin: 20, _new_waitWorkMin: 10, _new_handleSamples: 0, _new_handleWallMin: null, _new_handleWorkMin: null, totalProcessed: 2 },
    ];
    const [w] = aggregateStationHistoryWeekly(daily);
    // (100*1 + 20*3) / 4 = 40, NOT the unweighted 60.
    assert.equal(w._new_waitWallMin, 40);
    assert.equal(w._new_waitWorkMin, 20);
    assert.notEqual(w._new_waitWallMin, (100 + 20) / 2);
    // The samples themselves are summed, so the weight of the week is visible.
    assert.equal(w._new_waitSamples, 4);
    // ...and the flow count is summed, never averaged: a week is how many
    // closures happened in it.
    assert.equal(w.totalProcessed, 3);
    // §2.8 survives the fold: the work clock never overtakes the wall clock.
    assert.ok(Number(w._new_waitWorkMin) <= Number(w._new_waitWallMin));
  });

  it("A WEEK CONTAINING A GAP STAYS NULL — the days with no measurement are not zeros", () => {
    // Three days closed nothing at all. If they were read as 0 the week's wait
    // would be 25 minutes and the chart would draw a line that says the lab got
    // four times faster. They are not measurements, so they carry no weight.
    const daily = [
      { date: "2026-08-16", _new_waitSamples: 2, _new_waitWallMin: 100, _new_waitWorkMin: 60 },
      { date: "2026-08-17", _new_waitSamples: 0, _new_waitWallMin: null, _new_waitWorkMin: null },
      { date: "2026-08-18", _new_waitSamples: 0, _new_waitWallMin: null, _new_waitWorkMin: null },
      { date: "2026-08-19", _new_waitSamples: 0, _new_waitWallMin: null, _new_waitWorkMin: null },
    ];
    const [w] = aggregateStationHistoryWeekly(daily);
    assert.equal(w._new_waitWallMin, 100);
    assert.equal(w._new_waitWorkMin, 60);
    assert.notEqual(w._new_waitWallMin, 25);

    // ...and a week in which NOTHING closed is null on all four columns. Not 0:
    // "no wait was measured" and "the wait was zero minutes" are different
    // facts, and only the first one may be drawn as a gap.
    const [empty] = aggregateStationHistoryWeekly(
      daily.slice(1).map((d) => ({ ...d, _new_handleSamples: 0, _new_handleWallMin: null, _new_handleWorkMin: null })),
    );
    assert.equal(empty._new_waitWallMin, null);
    assert.equal(empty._new_waitWorkMin, null);
    assert.equal(empty._new_handleWallMin, null);
    assert.equal(empty._new_handleWorkMin, null);
    // The counts in the same row are still real zeros — the null is about the
    // DURATIONS only.
    assert.equal(empty.totalProcessed, 0);
    assert.equal(empty._new_waitSamples, 0);
  });

  it("weightedMeanOf ignores a value whose sample count is 0 or missing, and never divides by zero", () => {
    // A value with no weight is a value with no denominator; counting it would
    // be inventing a sample.
    assert.equal(
      weightedMeanOf([{ date: "d", v: 99, n: 0 }, { date: "d", v: 10, n: 2 }], "v", "n"),
      10,
    );
    assert.equal(weightedMeanOf([{ date: "d", v: 99 }], "v", "n"), null);
    assert.equal(weightedMeanOf([], "v", "n"), null);
    // A genuine zero-minute average IS a measurement and survives.
    assert.equal(weightedMeanOf([{ date: "d", v: 0, n: 3 }], "v", "n"), 0);
  });

  it("an empty input folds to an empty series, and a single day folds to its own week", () => {
    assert.deepEqual(aggregateEntityHistoryWeekly([], "finishedItems"), []);
    assert.deepEqual(aggregateStationHistoryWeekly([]), []);
    const [one] = aggregateEntityHistoryWeekly([{ date: "2026-08-19", itemsInQueue: 5, finishedItems: 7 }], "finishedItems");
    assert.equal(one.date, "2026-08-16");
    assert.equal(one.itemsInQueue, 5);
    assert.equal(one.finishedItems, 7);
    assert.equal(lastOf([], "finishedItems"), 0);
    assert.equal(meanOf([], "itemsInQueue"), 0);
  });
});

// ===========================================================================
// 2..4 — the ledger, entityHistory(), and the four routes
// ===========================================================================

/** The lock every suite that truncates the ledger takes. */
const LEDGER_TRUNCATE_LOCK = 526050825;

const CUSTOMER = 8801;
const CUSTOMER_EMPTY = 8802;
const SHIPMENT = 8811;
const SHIPMENT_EMPTY = 8812;
const IT_MAIN = 8821;
const IT_EMPTY = 8822;
const TY_A = 8010;
const TY_B = 8020;
const TY_R = 8030;
const ST_A = 8101; // TY_A — every test in the fixture happens here
const ST_IDLE = 8102; // TY_B — a real station that never saw an item
const ST_R = 8103; // TY_R, is_research
const WORKER_A = 8201;
const WORKER_A_NAME = "בודק א";

/** The state metric_state does not have on day one. entity-history.ts must
 *  surface it as `_new_quarantine` rather than fold it into a neighbour (§3.1). */
const NEW_STATE = "quarantine";
const NEW_STATE_LEGACY = 7;

const DAY_WORK_SECONDS = 8 * 3600;

type Ev = {
  key: string;
  day: string;
  hhmm: string;
  to: string;
  step: number;
  station: number | null;
  stationType: number | null;
  worker: number | null;
  reason: string;
  submit?: boolean;
};

type ItemPlan = { id: number; finalStatus: number; events: Ev[] };

describe("stage 6 — entity history against a deterministic ledger", { skip: skipReason() }, () => {
  let pool: Pool;
  let lockClient: import("pg").PoolClient;
  let prisma: { $disconnect: () => Promise<void> } & MetricsClient;
  let routes: Record<
    "customers" | "shipments" | "item-types" | "stations",
    (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  >;

  const T = () => todayBusinessDay();
  const D = (n: number) => addDays(T(), -n);

  /** The window every assertion below uses unless it is about the cap. */
  const from = () => D(11);
  const to = () => T();
  const period = () => resolvePeriod({ startDate: from(), endDate: to() });

  /** occurred_at of every seeded event, read back from Postgres — the wall
   *  clock's ground truth, so a DST night cannot make a hardcoded number wrong. */
  const evAt = new Map<string, Date>();
  const minutesBetween = (a: string, b: string) =>
    (evAt.get(b)!.getTime() - evAt.get(a)!.getTime()) / 60000;

  // -------------------------------------------------------------------------
  // The fixture. Chronological order is D11 (oldest) .. D0 (today).
  //
  //   D10  8301 runs and finishes           -> a closure, a wait, a test
  //   D9   NOTHING AT NOON. 8302 arrives at 15:00, after the sample instant
  //   D8   8302 tests and finishes          -> the second closure
  //   D7   8307 parks in `unmapped`, 8308 parks in `quarantine` — both forever
  //   D6   8303 joins the queue and stays
  //   D5   8304 starts a test and stays in it
  //   D4   8305 is sent to research and waits there
  //   D3   8306 is sent to research and is taken into it
  //
  // D9 is the whole point of half this file: a day with a measured zero in
  // every count and a null in every duration, between two days that have both.
  // -------------------------------------------------------------------------
  const PLAN: ItemPlan[] = [
    {
      id: 8301,
      finalStatus: 3,
      events: [
        { key: "8301-a", day: D(10), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "8301-b", day: D(10), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "8301-c", day: D(10), hhmm: "13:00", to: "done", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
      ],
    },
    {
      // The overnight wait: 15:00 on D9 to 09:00 on D8 is 18 wall-hours and 2
      // work-hours (15:00-16:00 plus 08:00-09:00). It is also why D9 is empty
      // at noon — the item does not exist yet when the grid samples the lab.
      id: 8302,
      finalStatus: 3,
      events: [
        { key: "8302-a", day: D(9), hhmm: "15:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "8302-b", day: D(8), hhmm: "09:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "8302-c", day: D(8), hhmm: "13:00", to: "done", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
      ],
    },
    {
      // §3.1 — a legacy status with no metric_state row lands in `unmapped`,
      // and it must stay VISIBLE. It never moves again.
      id: 8307,
      finalStatus: 9,
      events: [
        { key: "8307-a", day: D(7), hhmm: "09:00", to: "unmapped", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
      ],
    },
    {
      // The state the vocabulary grew after the code was written.
      id: 8308,
      finalStatus: NEW_STATE_LEGACY,
      events: [
        { key: "8308-a", day: D(7), hhmm: "09:00", to: NEW_STATE, step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
      ],
    },
    {
      id: 8303,
      finalStatus: 2,
      events: [
        { key: "8303-a", day: D(6), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
      ],
    },
    {
      id: 8304,
      finalStatus: 1,
      events: [
        { key: "8304-a", day: D(5), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "8304-b", day: D(5), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
      ],
    },
    {
      id: 8305,
      finalStatus: 4,
      events: [
        { key: "8305-a", day: D(4), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "8305-b", day: D(4), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "8305-c", day: D(4), hhmm: "11:00", to: "queued_research", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "sent_to_research", submit: true },
      ],
    },
    {
      id: 8306,
      finalStatus: 5,
      events: [
        { key: "8306-a", day: D(3), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "8306-b", day: D(3), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "8306-c", day: D(3), hhmm: "11:00", to: "queued_research", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "sent_to_research", submit: true },
        { key: "8306-d", day: D(3), hhmm: "11:30", to: "in_research", step: 1, station: ST_R, stationType: TY_R, worker: WORKER_A, reason: "test_started" },
      ],
    },
  ];

  async function q<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    return (await pool.query(sql, params)).rows as T[];
  }

  // -------------------------------------------------------------------------
  // setup / teardown
  // -------------------------------------------------------------------------

  before(async () => {
    // MUST precede the dynamic imports: src/app/lib/prisma.ts builds its Pool
    // from process.env.DATABASE_URL at module-evaluation time.
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    const req = createRequire(path.resolve(process.cwd(), "package.json"));
    const authPath = req.resolve("./auth.ts");
    const CjsModule = req("node:module") as any;
    const stub = new CjsModule(authPath, null);
    stub.filename = authPath;
    stub.loaded = true;
    stub.exports = {
      auth: async () => ({
        user: { name: "entity-history suite", email: "entityhistory@example.local" },
        roles: ["manager"],
      }),
      handlers: {},
      signIn: () => {},
      signOut: () => {},
    };
    req.cache[authPath] = stub;

    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
    await assertLedgerSchemaPresent();

    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [LEDGER_TRUNCATE_LOCK]);

    // The vocabulary grows. metric_state is NOT truncated between tests (it is
    // seed data), so this row is added once and removed in after() — no other
    // suite may see a sixth non-terminal state.
    await q(
      `INSERT INTO metric_state (state_key, legacy_status_id, label_he, is_terminal, is_waiting,
                                 is_active_work, is_research, at_station, sort_order)
       VALUES ($1, $2, 'הסגר', false, false, false, false, false, 60)
       ON CONFLICT (state_key) DO NOTHING`,
      [NEW_STATE, NEW_STATE_LEGACY],
    );

    const [customers, shipments, itemTypes, stations] = await Promise.all([
      import("../../../api/dashboard/customers/[id]/history/route"),
      import("../../../api/dashboard/shipments/[id]/history/route"),
      import("../../../api/dashboard/item-types/[id]/history/route"),
      import("../../../api/dashboard/stations/[id]/history/route"),
    ]);
    routes = {
      customers: customers.GET as never,
      shipments: shipments.GET as never,
      "item-types": itemTypes.GET as never,
      stations: stations.GET as never,
    };
    prisma = (await import("../../prisma")).prisma as never;
  });

  after(async () => {
    if (pool) {
      // Leave the vocabulary as it was found: an extra non-terminal state
      // changes the row count of every other suite's Q2א, and this file holds
      // the truncate lock precisely so nobody can see the intermediate state.
      //
      // The wipe comes FIRST and the failure is NOT swallowed. item_state_event
      // and item_state_interval both carry a foreign key onto
      // metric_state(state_key), so deleting the state while the fixture is
      // still seeded raises 23503 — and a swallowed 23503 here leaks the row
      // into the database for every later run of every other suite. Measured:
      // it did, and read-path.integration.test.ts went red on a sixth state it
      // had never heard of.
      await resetDb();
      await q("DELETE FROM metric_state WHERE state_key = $1", [NEW_STATE]);
      const [{ n }] = await q<{ n: number }>("SELECT count(*)::int AS n FROM metric_state WHERE state_key = $1", [NEW_STATE]);
      assert.equal(n, 0, "the suite left its extra metric_state row behind — every other suite will now fail");
    }
    if (prisma) await prisma.$disconnect();
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [LEDGER_TRUNCATE_LOCK]);
      lockClient.release();
    }
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await resetDb();
    await seedFixture();
    // metric_state is far below autovacuum's analyze threshold; without stats
    // Q2א's LATERAL is planned as a merge join.
    await q("ANALYZE item_state_interval, route_run, metric_state, item_state_event");
  });

  async function assertLedgerSchemaPresent(): Promise<void> {
    const [row] = await q<{ version: number | null; has_fold: boolean }>(`
      SELECT (SELECT version FROM metrics_schema_version WHERE id = 1) AS version,
             to_regprocedure('metrics_open_run(bigint,timestamptz)') IS NOT NULL AS has_fold
    `).catch(() => [] as any);
    if (!row?.has_fold || row.version == null) {
      throw new Error(
        "TEST_DATABASE_URL does not carry the metrics ledger schema — apply " +
          "prisma/migrations/20260825000000_metrics_ledger_additive first",
      );
    }
  }

  const TRUNCATE_TABLES = [
    "item_state_interval",
    "item_state_event",
    "route_run",
    "test_results",
    "item_route_history",
    "research_history",
    "item_routes",
    "items",
    "testing_routes",
    "test_stations",
    "test_stations_type",
    "item_types",
    "shipments",
    "customers",
    "daily_counters",
    "work_span",
    "work_calendar_version",
  ].join(", ");

  async function resetDb(): Promise<void> {
    await q("ALTER TABLE item_state_event DISABLE TRIGGER trg_ise_immutable");
    try {
      await q(`TRUNCATE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`);
    } finally {
      await q("ALTER TABLE item_state_event ENABLE TRIGGER trg_ise_immutable");
    }
  }

  /** The whole fixture in ONE transaction, so the deferred drift detector sees
   *  item_routes and the ledger agree at commit (§3.8). */
  async function seedFixture(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO customers (id, name, customer_code) VALUES
           ($1, 'לקוח פעיל', 'CUST-ACTIVE'),
           ($2, 'לקוח ללא פריטים', 'CUST-EMPTY')`,
        [CUSTOMER, CUSTOMER_EMPTY],
      );
      await client.query(
        `INSERT INTO shipments (id, shipment_code, customer_id, shipment_date, makat, amount, is_sent) VALUES
           ($1, 'SHIP-ACTIVE', $3, ($5::text || ' 08:00')::timestamp, 'MK-A', 10, false),
           ($2, 'SHIP-EMPTY',  $4, ($5::text || ' 08:00')::timestamp, 'MK-E',  0, false)`,
        [SHIPMENT, SHIPMENT_EMPTY, CUSTOMER, CUSTOMER_EMPTY, D(11)],
      );
      await client.query(
        "INSERT INTO item_types (item_type_id, item_type_desc) VALUES ($1, 'סוג פעיל'), ($2, 'סוג ללא פריטים')",
        [IT_MAIN, IT_EMPTY],
      );
      await client.query(
        `INSERT INTO test_stations_type (test_station_type_id, test_type_desc, parents_only) VALUES
           ($1, 'קליטה', false), ($2, 'תפקודית', false), ($3, 'מחקר', false)`,
        [TY_A, TY_B, TY_R],
      );
      await client.query(
        `INSERT INTO test_stations (test_station_id, test_station_type_id, test_station_desc, status, is_research) VALUES
           ($1, $4, 'עמדה א', 2, false),
           ($2, $5, 'עמדה בטלה', 2, false),
           ($3, $6, 'מעבדת מחקר', 2, true)`,
        [ST_A, ST_IDLE, ST_R, TY_A, TY_B, TY_R],
      );
      await client.query(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number)
         VALUES ($1, $2, ARRAY[$2::int, $3::int], 1)`,
        [IT_MAIN, TY_A, TY_B],
      );

      // 08:00-16:00 every day. The horizon reaches 120 days forward for the
      // same reason read-path's does: POST /api/cron/metrics-selfcheck heals a
      // calendar whose horizon is under 60 days, and that import is ESM-only.
      const horizonTo = addDays(T(), 120);
      const [{ calendar_version: ver }] = (
        await client.query(
          `INSERT INTO work_calendar_version (horizon_from, horizon_to, source_digest, is_current)
           VALUES ($1::date, $2::date, 'entity-history-fixture-0800-1600', true)
           RETURNING calendar_version`,
          [D(60), horizonTo],
        )
      ).rows;
      await client.query(
        `INSERT INTO work_span (calendar_version, work_date, span, span_seconds, cum_seconds_before)
         SELECT $1, d::date,
                tstzrange((d::date::text || ' 08:00')::timestamp AT TIME ZONE 'Asia/Jerusalem',
                          (d::date::text || ' 16:00')::timestamp AT TIME ZONE 'Asia/Jerusalem', '[)'),
                $4::int,
                $4::int * (row_number() OVER (ORDER BY d) - 1)
         FROM generate_series($2::date, $3::date, interval '1 day') d`,
        [ver, D(60), horizonTo, DAY_WORK_SECONDS],
      );

      for (const plan of PLAN) {
        const first = plan.events[0];
        await client.query(
          `INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model,
                              manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
           VALUES ($1, $2, $3, $4, $5, 'MODEL-EH', 'MFR', 'MFR-NO', $6, NULL)`,
          [plan.id, CUSTOMER, IT_MAIN, `SN-${plan.id}`, `MK-${plan.id}`, SHIPMENT],
        );
        await client.query(
          `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step,
                                    test_station_id, created_at, is_finished, queue_start_time, route_number)
           VALUES ($1, $2, $3, 1, NULL,
                   ($4::text || ' ' || $5::text)::timestamp, $6,
                   ($4::text || ' ' || $5::text)::timestamp, 1)`,
          [plan.id, IT_MAIN, plan.finalStatus, first.day, first.hhmm, plan.finalStatus === 3],
        );

        const [{ route_run_id: run }] = (
          await client.query(
            `SELECT metrics_open_run($1::bigint,
                    ($2::text || ' ' || $3::text)::timestamp AT TIME ZONE 'Asia/Jerusalem') AS route_run_id`,
            [plan.id, first.day, first.hhmm],
          )
        ).rows;

        for (const e of plan.events) {
          const [{ occurred_at }] = (
            await client.query(
              `INSERT INTO item_state_event
                 (event_key, route_run_id, item_id, occurred_at, seq, kind, to_state, step_no,
                  station_id, station_type_id, worker_id, worker_name, reason, submit_id)
               VALUES ($1, $2, $3,
                       ($4::text || ' ' || $5::text)::timestamp AT TIME ZONE 'Asia/Jerusalem',
                       0, 'transition', $6, $7, $8, $9, $10, $11, $12,
                       CASE WHEN $13::boolean THEN gen_random_uuid() END)
               RETURNING occurred_at`,
              [
                e.key, run, plan.id, e.day, e.hhmm, e.to, e.step,
                e.station, e.stationType, e.worker, e.worker === null ? null : WORKER_A_NAME,
                e.reason, e.submit === true,
              ],
            )
          ).rows;
          evAt.set(e.key, new Date(occurred_at));
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  const at = (points: EntityHistoryPoint[], day: string): EntityHistoryPoint => {
    const p = points.find((x) => x.date === day);
    assert.ok(p, `no point for ${day} — the series has a HOLE, which §5.0(7) forbids`);
    return p!;
  };

  /** The active slices of one point, by wire name. */
  const ACTIVE_FIELDS = [
    "itemsInQueue",
    "itemsInTest",
    "itemsWaitingForResearch",
    "itemsInResearch",
    "_new_unmapped",
    `_new_${NEW_STATE}`,
  ] as const;

  const slices = (p: EntityHistoryPoint) =>
    Object.fromEntries(ACTIVE_FIELDS.map((f) => [f, p[f]]));

  const zeroSlices = Object.fromEntries(ACTIVE_FIELDS.map((f) => [f, 0]));

  // =========================================================================
  // 2. entityHistory()
  // =========================================================================

  it("fixture sanity: the fold produced a legal ledger state and both clocks disagree exactly once", async () => {
    const [{ n: drift }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n
           FROM item_routes ir
           LEFT JOIN item_state_interval i
                  ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
          WHERE EXISTS (SELECT 1 FROM item_state_interval x WHERE x.item_id = ir.item_id)
            AND i.state_key IS DISTINCT FROM state_of(ir.current_status)`,
    );
    assert.equal(drift, 0);

    const [{ n: bad }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM item_state_interval
        WHERE closed_at IS NOT NULL AND NOT is_terminal
          AND (wall_seconds IS NULL OR work_seconds IS NULL OR work_seconds > wall_seconds)`,
    );
    assert.equal(bad, 0);

    // The overnight wait: 2 work-hours (15:00-16:00 + 08:00-09:00) inside 18
    // wall-hours. Every other interval sits inside one 08:00-16:00 span, so
    // this is the row that proves work and wall are two measurements.
    const [{ work_seconds: work, wall_seconds: wall }] = await q<{ work_seconds: number; wall_seconds: number }>(
      `SELECT work_seconds, wall_seconds FROM item_state_interval
        WHERE item_id = 8302 AND state_key = 'queued'`,
    );
    assert.equal(work, 2 * 3600);
    assert.equal(wall / 60, minutesBetween("8302-a", "8302-b"));
    assert.ok(wall > work);

    // §3.1: the two parked items are real intervals in states nothing else
    // touches, and neither of them is at a station.
    const parked = await q<{ state_key: string; station_id: number | null }>(
      "SELECT state_key, station_id FROM item_state_interval WHERE item_id IN (8307, 8308) ORDER BY item_id",
    );
    assert.deepEqual(parked, [
      { state_key: "unmapped", station_id: null },
      { state_key: NEW_STATE, station_id: null },
    ]);
  });

  it("Q2א maps EVERY metric_state key to its own output field, and drops none of them", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");

    // Every non-terminal state the vocabulary knows has a field on every point.
    // Derived from the DATABASE, not from a list retyped here: a state added to
    // metric_state and forgotten in entity-history.ts must fail this.
    const states = await q<{ state_key: string }>(
      "SELECT state_key FROM metric_state WHERE NOT is_terminal ORDER BY sort_order",
    );
    const WIRE_NAME: Record<string, string> = {
      queued: "itemsInQueue",
      testing: "itemsInTest",
      queued_research: "itemsWaitingForResearch",
      in_research: "itemsInResearch",
      unmapped: "_new_unmapped",
    };
    for (const { state_key } of states) {
      const field = WIRE_NAME[state_key] ?? `_new_${state_key}`;
      for (const p of points) {
        assert.equal(typeof p[field], "number", `${p.date}.${field} (state ${state_key}) is not a number`);
      }
    }
    assert.equal(states.length, 6); // the five shipped + the one this suite added

    // D3 is the day every slice is occupied at once, so the mapping is checked
    // as a whole rather than one state at a time.
    assert.deepEqual(slices(at(points, D(3))), {
      itemsInQueue: 1, // 8303
      itemsInTest: 1, // 8304
      itemsWaitingForResearch: 1, // 8305
      itemsInResearch: 1, // 8306, taken in at 11:30
      _new_unmapped: 1, // 8307
      [`_new_${NEW_STATE}`]: 1, // 8308
    });
    // `done` is not a slice of Q2א at all (§5.2) — the two finished items are
    // in the cumulative line and nowhere else.
    assert.equal("done" in at(points, D(3)), false);
    assert.equal("_new_done" in at(points, D(3)), false);
  });

  it("§3.1 — an item parked in `unmapped` is a VISIBLE series, not a dropped row", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");
    // Present on every single day, so the line exists before it is interesting
    // and the day it stops being zero is visible.
    assert.equal(points.every((p) => typeof p._new_unmapped === "number"), true);
    assert.equal(at(points, D(8))._new_unmapped, 0); // 8307 has not arrived
    assert.equal(at(points, D(7))._new_unmapped, 1); // ...and now it has
    assert.equal(at(points, T())._new_unmapped, 1); // ...and it never left
    // It is its own slice: no other count moved when it appeared.
    assert.equal(at(points, D(7)).itemsInQueue, 0);
    assert.equal(at(points, D(7)).itemsInTest, 0);
  });

  it("an unknown state_key surfaces as _new_<key> instead of being added into a neighbour", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");
    const field = `_new_${NEW_STATE}`;
    assert.equal(at(points, D(8))[field], 0);
    assert.equal(at(points, D(7))[field], 1);
    assert.equal(at(points, T())[field], 1);
    // The neighbour test: `unmapped` sits next to it in the vocabulary and both
    // items arrived on the same day at the same minute. If the fallback folded
    // one into the other, one of these would read 2 and the other 0.
    assert.equal(at(points, D(7))._new_unmapped, 1);
    // ...and it is a field, not a stringified key collision.
    assert.equal(typeof at(points, T())[field], "number");
  });

  it("_new_activeTotal is the sum of the ACTIVE states of its OWN row, on every row", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");
    for (const p of points) {
      const expected = ACTIVE_FIELDS.reduce((acc, f) => acc + Number(p[f]), 0);
      assert.equal(p._new_activeTotal, expected, `${p.date}: activeTotal`);
    }
    // Not a rolling total and not the whole window: D3 onwards holds six items,
    // D9 holds none, and the cumulative finished line is NOT part of it.
    assert.equal(at(points, D(3))._new_activeTotal, 6);
    assert.equal(at(points, D(9))._new_activeTotal, 0);
    assert.equal(at(points, T()).finishedItems, 2);
    assert.equal(at(points, T())._new_activeTotal, 6);
  });

  it("§5.3ב — the cumulative line equals a DIRECT count over route_run closures, day by day", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");

    // The oracle is a count(*) over the anchor §5.3ב names, computed in SQL and
    // independently of the query under test: closures that are trusted, closed,
    // belong to this customer, and happened on or before the grid day.
    const oracle = await q<{ business_day: string; n: number }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS business_day,
              (SELECT count(*)::int FROM route_run rr
                WHERE rr.is_trusted AND rr.closed_at IS NOT NULL
                  AND rr.customer_id = $3
                  AND business_date(rr.closed_at) <= d::date) AS n
         FROM generate_series($1::date, $2::date, interval '1 day') d
        ORDER BY 1`,
      [from(), to(), CUSTOMER],
    );
    assert.equal(oracle.length, points.length);
    for (const row of oracle) {
      assert.equal(
        at(points, row.business_day).finishedItems,
        row.n,
        `${row.business_day}: cumulative closures`,
      );
    }
    // And the shape of that oracle, so a run in which it accidentally returns
    // all zeros cannot pass: the curve really does step twice.
    assert.equal(at(points, D(11)).finishedItems, 0);
    assert.equal(at(points, D(10)).finishedItems, 1);
    assert.equal(at(points, D(9)).finishedItems, 1);
    assert.equal(at(points, D(8)).finishedItems, 2);
    assert.equal(at(points, T()).finishedItems, 2);

    // The additive twin is per-day and lands on the day the closure happened.
    assert.equal(at(points, D(10))._new_finishedToday, 1);
    assert.equal(at(points, D(9))._new_finishedToday, 0);
    assert.equal(at(points, D(8))._new_finishedToday, 1);
    assert.equal(points.reduce((a, p) => a + Number(p._new_finishedToday), 0), 2);
  });

  it("NO GAP FILL — the empty day is a measured zero, not the day before repeated", async () => {
    const { points } = await entityHistory(prisma, period(), { customerId: CUSTOMER, scope: "all" }, "finishedItems");
    // D10 had an item in test; D9 has nothing at noon; D8 has an item in test
    // again. A carry-forward would put 1 in the middle, and dropping the empty
    // day would leave a hole the chart would draw a straight line across.
    assert.equal(at(points, D(10)).itemsInTest, 1);
    assert.deepEqual(slices(at(points, D(9))), zeroSlices);
    assert.equal(at(points, D(8)).itemsInTest, 1);
    // The cumulative line is NOT a gap-fill: it legitimately holds its value
    // across the empty day, because a running total of closures is what it is.
    assert.equal(at(points, D(9)).finishedItems, 1);
    assert.equal(at(points, D(9))._new_finishedToday, 0);
  });

  it("an entity with NO data returns a full-length zero series — not [], not an error", async () => {
    const p = period();
    const days = daysBetween(p.from, p.to);
    for (const filters of [
      { customerId: CUSTOMER_EMPTY, scope: "all" as const },
      { shipmentId: SHIPMENT_EMPTY, scope: "all" as const },
      { itemTypeId: IT_EMPTY, scope: "all" as const },
    ]) {
      const { points } = await entityHistory(prisma, p, filters, "itemsFinished");
      assert.equal(points.length, days, `${JSON.stringify(filters)}: length`);
      assert.equal(points[0].date, p.from);
      assert.equal(points[points.length - 1].date, p.to);
      for (const point of points) {
        assert.deepEqual(slices(point), zeroSlices, `${point.date}: an empty entity has zeros`);
        assert.equal(point._new_activeTotal, 0);
        assert.equal(point.itemsFinished, 0);
        assert.equal(point._new_finishedToday, 0);
      }
    }
  });

  it("the grid is every civil day of the window, in order, with isToday on today alone", async () => {
    const p = period();
    const { points, ignoredFilters } = await entityHistory(
      prisma, p, { customerId: CUSTOMER, scope: "all" }, "finishedItems",
    );
    assert.equal(points.length, daysBetween(p.from, p.to));
    for (let i = 0; i < points.length; i++) {
      assert.equal(points[i].date, addDays(p.from, i), `point ${i}`);
    }
    assert.equal(points.filter((x) => x.isToday === true).length, 1);
    assert.equal(points[points.length - 1].isToday, true);
    assert.equal(points[points.length - 1].date, T());
    // §5.0(1): route_run carries customer_id, so nothing is dropped and the
    // list says so by being empty rather than by being absent.
    assert.deepEqual(ignoredFilters, []);
  });

  it("§5.0(1) — a filter Q2ב cannot express is NAMED, and the point-in-time half still honours it", async () => {
    const { points, ignoredFilters } = await entityHistory(
      prisma, period(), { customerId: CUSTOMER, stationId: ST_A, scope: "all" }, "finishedItems",
    );
    // route_run has no station dimension: the cumulative line cannot be
    // narrowed to a station, and that is reported instead of being pretended.
    assert.deepEqual(ignoredFilters, ["stationId"]);
    // The Q2א half DOES honour it — only items held at ST_A are counted, and a
    // `queued` interval never carries a station_id (§3.6).
    assert.equal(at(points, D(3)).itemsInTest, 1); // 8304
    assert.equal(at(points, D(3)).itemsInQueue, 0);
    assert.equal(at(points, D(3))._new_unmapped, 0);
  });

  // =========================================================================
  // 4. THE FOUR ROUTES
  // =========================================================================

  type Res = { status: number; body: any; headers: Headers };

  async function call(
    name: keyof typeof routes,
    id: string | number,
    query = "period=alldays",
  ): Promise<Res> {
    const url = `http://localhost/api/dashboard/${name}/${id}/history?${query}`;
    const res = await routes[name](new Request(url) as never, {
      params: Promise.resolve({ id: String(id) }),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }

  /** Every route, the id that HAS data, and the id that has none. */
  const ROUTE_CASES = [
    { name: "customers" as const, live: CUSTOMER, empty: CUSTOMER_EMPTY, finished: "finishedItems" },
    { name: "shipments" as const, live: SHIPMENT, empty: SHIPMENT_EMPTY, finished: "itemsFinished" },
    { name: "item-types" as const, live: IT_MAIN, empty: IT_EMPTY, finished: "itemsFinished" },
    { name: "stations" as const, live: ST_A, empty: ST_IDLE, finished: null },
  ];

  it("every [id]/history route answers 200 with a full daily series on the default window", async () => {
    const capFloor = addDays(addMonths(T(), -UI_MONTH_CAP), 1);
    const days = daysBetween(capFloor, T());
    for (const c of ROUTE_CASES) {
      const { status, body, headers } = await call(c.name, c.live);
      assert.equal(status, 200, `${c.name}: ${JSON.stringify(body).slice(0, 200)}`);
      assert.ok(Array.isArray(body), `${c.name} did not answer an array`);
      // `alldays` is the 13-month window the UI is allowed to ask for (§6.3),
      // and every civil day of it is a row — the old routes answered ONE.
      assert.equal(body.length, days, `${c.name}: series length`);
      assert.ok(body.length > 30, `${c.name}: the old snapshot route's answer was a single point`);
      assert.equal(body[0].date, capFloor, `${c.name}: first day`);
      assert.equal(body[body.length - 1].date, T(), `${c.name}: last day`);
      assert.equal(body[body.length - 1].isToday, true);
      assert.equal(body.filter((r: any) => r.isToday === true).length, 1);
      // §5.0(1): a history endpoint is pinned to scope=all and says so.
      assert.equal(headers.get("x-metrics-scope"), "all", `${c.name}: scope header`);
      assert.equal(headers.get("x-metrics-period-from"), capFloor);
      assert.equal(headers.get("x-metrics-period-to"), T());
      assert.equal(headers.get("x-metrics-period-capped"), null);
      assert.equal(headers.get("x-metrics-period-granularity"), "daily");
    }
  });

  it("an id with NO data returns the SAME envelope, zero-filled, with HTTP 200", async () => {
    for (const c of ROUTE_CASES) {
      const live = await call(c.name, c.live, `startDate=${from()}&endDate=${to()}`);
      const empty = await call(c.name, c.empty, `startDate=${from()}&endDate=${to()}`);
      assert.equal(empty.status, 200, `${c.name}: an entity with no history is not an error`);
      assert.equal(empty.body.length, live.body.length, `${c.name}: same length`);
      // The same KEYS, so the chart binds to the same fields and a missing line
      // is a zero line rather than an undefined one.
      assert.deepEqual(
        Object.keys(empty.body[0]).sort(),
        Object.keys(live.body[0]).sort(),
        `${c.name}: the envelope must not depend on whether there is data`,
      );
      for (const row of empty.body) {
        for (const [k, v] of Object.entries(row)) {
          if (k === "date" || k === "isToday") continue;
          // Counts are measured zeros; the §2.8 durations are nulls, because
          // nothing closed and "no measurement" is not "zero minutes" (§5.0(7)).
          const isDuration = /Min$|Minutes$/.test(k);
          if (isDuration) assert.equal(v, null, `${c.name} ${row.date}.${k}`);
          else assert.equal(v, 0, `${c.name} ${row.date}.${k}`);
        }
      }
    }
  });

  it("the 13-month cap and its headers behave as on the ten converted endpoints", async () => {
    const capFloor = addDays(addMonths(T(), -UI_MONTH_CAP), 1);
    for (const c of ROUTE_CASES) {
      // `3years` is the dialog's own third preset: requested in full, capped,
      // and REPORTED as capped — §6.3 is a cap on the UI, not a promise the
      // server quietly breaks.
      const far = await call(c.name, c.live, "period=3years");
      assert.equal(far.status, 200);
      assert.equal(far.headers.get("x-metrics-period-capped"), "true", `${c.name}: capped`);
      assert.equal(far.headers.get("x-metrics-period-from"), capFloor);
      assert.equal(far.headers.get("x-metrics-period-cap-floor"), capFloor);
      assert.equal(
        far.headers.get("x-metrics-period-requested-from"),
        addDays(addMonths(T(), -36), 1),
        `${c.name}: the request survives beside the answer`,
      );
      assert.equal(far.body.length, daysBetween(capFloor, T()));
      assert.equal(far.body[0].date, capFloor);

      // An explicit window that reaches into the future is clamped and says so.
      const future = await call(c.name, c.live, `startDate=${from()}&endDate=${addDays(T(), 30)}`);
      assert.equal(future.status, 200);
      assert.equal(future.headers.get("x-metrics-period-clamped-end"), "true");
      assert.equal(future.headers.get("x-metrics-period-to"), T());
      assert.equal(future.body[future.body.length - 1].date, T());

      // A window with no future and no cap reports neither.
      const plain = await call(c.name, c.live, `startDate=${from()}&endDate=${to()}`);
      assert.equal(plain.headers.get("x-metrics-period-capped"), null);
      assert.equal(plain.headers.get("x-metrics-period-clamped-end"), null);
      assert.equal(plain.body.length, daysBetween(from(), to()));
    }
  });

  it("NO _new_ field is null across every row of the default window (the stage-5 assertion)", async () => {
    const offenders: string[] = [];
    for (const c of ROUTE_CASES) {
      const { body } = await call(c.name, c.live, `startDate=${from()}&endDate=${to()}`);
      const seen = new Map<string, number>();
      const nulls = new Map<string, number>();
      for (const row of body) {
        for (const [k, v] of Object.entries(row)) {
          if (!k.startsWith("_new_")) continue;
          seen.set(k, (seen.get(k) ?? 0) + 1);
          if (v === null || v === undefined) nulls.set(k, (nulls.get(k) ?? 0) + 1);
        }
      }
      assert.ok(seen.size > 0, `${c.name} carries no _new_ field at all`);
      for (const [k, n] of seen) {
        // A field null on SOME days is data — the station's durations are null
        // on a day nothing closed, and that is the §5.0(7) gap. A field null on
        // EVERY day of a window the fixture fills is finding #1's shape.
        if ((nulls.get(k) ?? 0) === n) offenders.push(`${c.name}.${k} (null on all ${n} rows)`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these §2.8 / §3.1 additions came back null on every row of a window the fixture fills:\n  " +
        offenders.join("\n  "),
    );
  });

  it("the entity dialogs' series is the one entityHistory() computed, under the right wire name", async () => {
    for (const c of ROUTE_CASES.filter((x) => x.finished)) {
      const { body } = await call(c.name, c.live, `startDate=${from()}&endDate=${to()}`);
      const byDay = new Map(body.map((r: any) => [r.date, r]));
      const day = (d: string) => byDay.get(d) as any;
      // The same three facts the unit tests proved, now over HTTP-shaped JSON:
      // every slice occupied on D3, an empty day at D9, and the cumulative line
      // stepping twice under this endpoint's own name.
      assert.equal(day(D(3)).itemsInQueue, 1, c.name);
      assert.equal(day(D(3)).itemsInTest, 1, c.name);
      assert.equal(day(D(3)).itemsWaitingForResearch, 1, c.name);
      assert.equal(day(D(3)).itemsInResearch, 1, c.name);
      assert.equal(day(D(3))._new_unmapped, 1, c.name);
      assert.equal(day(D(3))[`_new_${NEW_STATE}`], 1, c.name);
      assert.equal(day(D(3))._new_activeTotal, 6, c.name);
      assert.equal(day(D(9))._new_activeTotal, 0, c.name);
      assert.equal(day(D(9)).itemsInTest, 0, c.name);
      assert.equal(day(D(10))[c.finished!], 1, c.name);
      assert.equal(day(D(9))[c.finished!], 1, c.name);
      assert.equal(day(D(8))[c.finished!], 2, c.name);
      assert.equal(day(T())[c.finished!], 2, c.name);
    }
  });

  it("the station dialog: every duration is a wall/work PAIR, and work never overtakes wall", async () => {
    const { body } = await call("stations", ST_A, `startDate=${from()}&endDate=${to()}`);
    const unpaired: string[] = [];
    const crossed: string[] = [];
    let pairs = 0;
    let measured = 0;

    for (const row of body) {
      for (const [k, wall] of Object.entries(row)) {
        if (!k.includes("Wall")) continue;
        const sib = k.replace("Wall", "Work");
        if (!(sib in row)) {
          unpaired.push(`${row.date}.${k} — expected ${sib} beside it`);
          continue;
        }
        pairs++;
        const work = (row as any)[sib];
        // §5.0(7) again, at the pair level: a day is measured on BOTH clocks or
        // on neither. One half null and the other a number would be a duration
        // that half-exists.
        assert.equal(
          wall === null,
          work === null,
          `${row.date}: ${k} and ${sib} disagree about whether the day was measured`,
        );
        if (wall === null) continue;
        measured++;
        if (typeof wall === "number" && typeof work === "number" && work > wall + 1e-6) {
          crossed.push(`${row.date}: ${sib}=${work} > ${k}=${wall}`);
        }
      }
    }

    assert.deepEqual(unpaired, [], "a duration shipped on one clock only:\n  " + unpaired.join("\n  "));
    assert.deepEqual(crossed, [], "the work clock ran past the wall clock:\n  " + crossed.join("\n  "));
    assert.equal(pairs, body.length * 2, "two pairs per day: the wait pair and the handling pair");
    assert.ok(measured >= 4, `the fixture must actually measure something, got ${measured}`);
  });

  it("the station dialog's numbers, and its gap: D9 closed nothing and reads NULL, not 0", async () => {
    const { body } = await call("stations", ST_A, `startDate=${from()}&endDate=${to()}`);
    const byDay = new Map(body.map((r: any) => [r.date, r]));
    const day = (d: string) => byDay.get(d) as any;

    // D10: one 60-minute wait and one 180-minute test closed here.
    assert.equal(day(D(10)).totalProcessed, 1);
    assert.equal(day(D(10))._new_waitSamples, 1);
    assert.equal(day(D(10))._new_waitWorkMin, 60);
    assert.equal(day(D(10))._new_waitWallMin, 60);
    assert.equal(day(D(10))._new_handleWorkMin, 180);
    assert.equal(day(D(10))._new_handleWallMin, 180);

    // D8: the overnight wait closes here — 120 work-minutes inside 18 wall-hours.
    assert.equal(day(D(8))._new_waitWorkMin, 120);
    assert.equal(day(D(8))._new_waitWallMin, minutesBetween("8302-a", "8302-b"));
    assert.ok(day(D(8))._new_waitWallMin > day(D(8))._new_waitWorkMin);
    assert.equal(day(D(8))._new_handleWorkMin, 240);

    // D9 — THE GAP. Nothing closed, so all four durations are null and the
    // chart draws a hole. A carry-forward would repeat D10's 60/180 here, and
    // a zero-fill would claim the lab answered instantly.
    assert.equal(day(D(9)).totalProcessed, 0);
    assert.equal(day(D(9))._new_waitSamples, 0);
    assert.equal(day(D(9))._new_handleSamples, 0);
    for (const f of ["_new_waitWallMin", "_new_waitWorkMin", "_new_handleWallMin", "_new_handleWorkMin"]) {
      assert.equal(day(D(9))[f], null, `${f} on the empty day`);
      assert.notEqual(day(D(9))[f], 0, `${f} must not read as a measured zero`);
    }

    // The counts on the same day are real zeros — the station stood idle, and
    // that is a fact about the station rather than a missing measurement.
    assert.equal(day(D(9)).itemsInTest, 0);
    assert.equal(day(D(9))._new_sharedTypeQueue, 0);

    // §5.4 — the queue belongs to the TYPE. 8303 waits for TY_A from D6 on and
    // is reported on ST_A's row; ST_A itself holds only the item under test.
    assert.equal(day(D(3))._new_sharedTypeQueue, 1);
    assert.equal(day(D(3)).itemsInTest, 1);
    assert.equal(day(D(3))._new_inResearch, 0);
  });

  it("the station route: 404 for a station that does not exist, 400 for an id that is not one", async () => {
    const missing = await call("stations", 999999, `startDate=${from()}&endDate=${to()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "Station not found");

    for (const [name, message] of [
      ["customers", "Customer ID is required"],
      ["shipments", "Shipment ID is required"],
      ["item-types", "Item Type ID is required"],
      ["stations", "Station ID is required"],
    ] as const) {
      const bad = await call(name, "not-a-number");
      assert.equal(bad.status, 400, name);
      assert.equal(bad.body.error, message);
    }

    // A malformed window is still a 400 with the message the clients know.
    const badDates = await call("customers", CUSTOMER, "startDate=nope&endDate=also-nope");
    assert.equal(badDates.status, 400);
    assert.equal(badDates.body.error, "Invalid date format");
  });

  it("the weekly fold over a REAL response keeps the gap and takes the cumulative at its end", async () => {
    // The last link in the chain: what the dialog actually draws once the
    // series is longer than 30 points. Nothing else in this file runs the fold
    // over data the database produced.
    const { body: entity } = await call("customers", CUSTOMER, `startDate=${from()}&endDate=${to()}`);
    const weeks = aggregateEntityHistoryWeekly(entity, "finishedItems");
    assert.ok(weeks.length >= 2, "a 12-day window spans at least two civil weeks");
    // The cumulative line is monotone across the folded weeks and ends where
    // the daily series ended.
    const finals = weeks.map((w) => Number(w.finishedItems));
    assert.deepEqual(finals, [...finals].sort((a, b) => a - b));
    assert.equal(finals[finals.length - 1], 2);
    assert.equal(weeks.reduce((a, w) => a + Number(w._new_finishedToday), 0), 2);

    const { body: station } = await call("stations", ST_A, `startDate=${from()}&endDate=${to()}`);
    const stationWeeks = aggregateStationHistoryWeekly(station);
    // Every closure survives the fold as a count: four active-work intervals
    // closed at ST_A in this window (8301, 8302, 8305, 8306). 8304's test is
    // still running and has therefore processed nothing yet.
    assert.equal(stationWeeks.reduce((a, w) => a + Number(w.totalProcessed), 0), 4);
    // ...and a week in which the station closed nothing keeps its null.
    for (const w of stationWeeks) {
      const measured = Number(w._new_waitSamples) > 0;
      assert.equal(w._new_waitWallMin === null, !measured, `${w.date}: wait wall`);
      assert.equal(w._new_waitWorkMin === null, !measured, `${w.date}: wait work`);
      if (measured) assert.ok(Number(w._new_waitWorkMin) <= Number(w._new_waitWallMin) + 1e-6);
    }
  });
});
