// Stage-5 READ-PATH integration suite (docs/dashboard-migration-plan-v2.md
// §5 the read path, §5.0 the cross-cutting rules, §2.8 the two clocks, §6.3 the
// UI cap).
//
// WHY IT EXISTS. Stage 5 shipped ten converted endpoints and eight query
// builders with ZERO tests; the only thing watching them was
// scripts/dashboard-parity.js, and it was watching the wrong object — its
// default mode graded a second copy of each route's mapping, and its row
// comparison only ever looked at fields the OLD response carried, so every
// §2.8 addition was stamped NEW_ONLY and never read. That is how four
// permanently-null fields on tests/by-station passed a green parity run twice.
// The harness is fixed; this suite is the other half, and it drives the REAL
// route handlers, not a copy of their arithmetic.
//
// HOW THE ROUTES ARE REACHED. All fourteen dashboard routes are
// withAuth(role:"manager"), and withAuth calls Auth.js's auth(), which reads
// the request scope through next/headers — there is no request scope in a bare
// node:test process, so auth() throws before the handler is entered. tsx loads
// these TypeScript modules as CJS, so the fix is a CJS one: the root auth.ts
// module object is placed in require.cache BEFORE anything imports it, carrying
// an auth() that returns a manager session. withAuth itself is the real one —
// the role check runs for real — and the response under test is the route's
// own, byte for byte.
//
// THE FIXTURE IS THE LEDGER'S OWN FOLD. Nothing here writes item_state_interval
// directly. Events are inserted into item_state_event with chosen occurred_at
// values and trg_isi_apply folds them exactly as the write path does, so the
// intervals carry the real wall/work seconds, the real attempt_no and the real
// station semantics (a `queued` interval with no station_id at all, a
// `queued_research` interval with no station type). A golden row here is
// therefore a statement about §5's SQL, not about a hand-written table.
//
// THE WORK CALENDAR IS 08:00-16:00 EVERY DAY, so the work clock is arithmetic a
// reader can check: a whole day is 28,800 seconds and every fixture event sits
// inside a span. Israel changes clocks at 02:00, never inside 08:00-16:00, so
// the work numbers are DST-proof; the wall numbers that cross midnight are
// derived from the instants Postgres actually stored rather than hardcoded.
//
// SERIALISATION. `node --test` runs test FILES in parallel (measured: two
// three-second files finished in 3.99s). This suite and
// write-path.integration.test.ts both TRUNCATE the ledger, so they must not
// overlap; both take the same session-level advisory lock for the life of the
// file. observability.integration.test.ts never truncates and needs no lock.
//
// The DB half runs ONLY when TEST_DATABASE_URL points at a throwaway database
// carrying migration 20260825000000_metrics_ledger_additive. Without it those
// describe blocks skip and plain `npm test` stays green. The two pure blocks
// (period arithmetic and the §5.0(9) build-time sweep) touch nothing and run
// unconditionally — they are the parts that protect a `next build`.
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool, types } from "pg";

import {
  UI_MONTH_CAP,
  addDays,
  addMonths,
  businessDay,
  daysBetween,
  endOfBusinessDayExclusive,
  resolvePeriod,
  startOfBusinessDay,
  todayBusinessDay,
} from "../period";
import {
  QUERY_BUILDERS,
  allBuiltStatements,
  guardAllBuilders,
  guardRangeProbes,
  entityProgress,
  finishedCumulative,
  finishedInWindow,
  flow,
  kpiWindowOne,
  pitSeries,
  pointInTime,
  quality,
  slowSteps,
  stationBoard,
  type MetricsClient,
} from "../queries";

// pg hands bigint (OID 20) and numeric (1700) back as strings by default; every
// value this suite asserts on fits a JS number.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

function skipReason(): string | false {
  return TEST_DATABASE_URL
    ? false
    : "TEST_DATABASE_URL is not set — stage-5 read-path integration suite skipped";
}

// ===========================================================================
// §6.3 / §7.2 — resolvePeriod: the cap, the clamp, and DST
// ===========================================================================

describe("stage 5 — resolvePeriod (§6.3 the 13-month cap, §7.2 business days)", () => {
  // A fixed clock, so these assertions are about the arithmetic and not about
  // the day the suite happens to run on.
  const NOW = new Date("2026-08-28T09:00:00Z"); // 12:00 Asia/Jerusalem
  const TODAY = "2026-08-28";

  it("caps a 3-year request at 13 calendar months and REPORTS the cap", () => {
    const p = resolvePeriod({ startDate: "2023-01-01", endDate: TODAY, now: NOW });
    // A calendar cap, not 13 * 30 days: the floor is the day after the same
    // day-of-month 13 months back, which is what the picker shows (§6.3).
    const floor = addDays(addMonths(TODAY, -UI_MONTH_CAP), 1);
    assert.equal(floor, "2025-07-29");
    assert.equal(p.capFloor, floor);
    assert.equal(p.from, floor);
    assert.equal(p.capped, true);
    // The request survives beside the answer — a route cannot report "showing
    // X of Y" from a window that forgot what was asked for.
    assert.equal(p.requestedFrom, "2023-01-01");
    assert.equal(p.days, daysBetween(floor, TODAY));
  });

  it("does not cap a window that starts exactly on the floor, and does cap one day earlier", () => {
    const floor = addDays(addMonths(TODAY, -UI_MONTH_CAP), 1);
    assert.equal(resolvePeriod({ startDate: floor, endDate: TODAY, now: NOW }).capped, false);
    const justOver = resolvePeriod({ startDate: addDays(floor, -1), endDate: TODAY, now: NOW });
    assert.equal(justOver.capped, true);
    assert.equal(justOver.from, floor);
  });

  it("clamps a request that reaches into the future to today, and REPORTS the clamp", () => {
    const p = resolvePeriod({ startDate: "2026-08-01", endDate: "2026-12-31", now: NOW });
    assert.equal(p.to, TODAY);
    assert.equal(p.clampedEnd, true);
    assert.equal(p.requestedTo, "2026-12-31");
    assert.equal(p.capped, false);
  });

  it("a window entirely in the future degenerates to today rather than to an error", () => {
    const p = resolvePeriod({ startDate: "2027-01-01", endDate: "2027-02-01", now: NOW });
    assert.equal(p.from, TODAY);
    assert.equal(p.to, TODAY);
    assert.equal(p.days, 1);
    assert.equal(p.clampedEnd, true);
  });

  it("both clamps can fire at once and both are reported", () => {
    const p = resolvePeriod({ startDate: "2020-01-01", endDate: "2030-01-01", now: NOW });
    assert.equal(p.capped, true);
    assert.equal(p.clampedEnd, true);
    assert.equal(p.from, p.capFloor);
    assert.equal(p.to, TODAY);
  });

  it("startDate after endDate is a PeriodError, not a silently swapped window", () => {
    assert.throws(
      () => resolvePeriod({ startDate: "2026-08-20", endDate: "2026-08-01", now: NOW }),
      /startDate .* is after endDate/,
    );
  });

  // -------------------------------------------------------------------------
  // DST. Israel starts DST on the Friday before the last Sunday of March and
  // ends it on the last Sunday of October, both at 02:00 — 2026-03-27 and
  // 2026-10-25. Those two days are 23 and 25 hours long, and every one of
  // §7.3(2)'s rules exists because `timestamptz + interval '1 day'` is not a
  // civil day.
  // -------------------------------------------------------------------------

  it("2026-03-27 is a 23-hour business day and its boundaries are local midnight", () => {
    const start = startOfBusinessDay("2026-03-27");
    const end = endOfBusinessDayExclusive("2026-03-27");
    assert.equal(start.toISOString(), "2026-03-26T22:00:00.000Z"); // 00:00 +02:00
    assert.equal(end.toISOString(), "2026-03-27T21:00:00.000Z"); // 00:00 +03:00
    assert.equal((end.getTime() - start.getTime()) / 3600000, 23);
    // The days on either side are ordinary, so the hour is lost exactly once.
    for (const d of ["2026-03-26", "2026-03-28"]) {
      const s = startOfBusinessDay(d);
      const e = endOfBusinessDayExclusive(d);
      assert.equal((e.getTime() - s.getTime()) / 3600000, 24, d);
    }
  });

  it("2026-10-25 is a 25-hour business day and its boundaries are local midnight", () => {
    const start = startOfBusinessDay("2026-10-25");
    const end = endOfBusinessDayExclusive("2026-10-25");
    assert.equal(start.toISOString(), "2026-10-24T21:00:00.000Z"); // 00:00 +03:00
    assert.equal(end.toISOString(), "2026-10-25T22:00:00.000Z"); // 00:00 +02:00
    assert.equal((end.getTime() - start.getTime()) / 3600000, 25);
    for (const d of ["2026-10-24", "2026-10-26"]) {
      const s = startOfBusinessDay(d);
      const e = endOfBusinessDayExclusive(d);
      assert.equal((e.getTime() - s.getTime()) / 3600000, 24, d);
    }
  });

  it("business days are counted as CIVIL dates across both boundaries, never as 86,400-second steps", () => {
    // The bug this rules out: a range built by adding 24h at a time loses a day
    // in March and gains one in October (§7.3(2)).
    assert.equal(addDays("2026-03-26", 2), "2026-03-28");
    assert.equal(addDays("2026-10-24", 2), "2026-10-26");
    assert.equal(daysBetween("2026-03-25", "2026-03-30"), 6);
    assert.equal(daysBetween("2026-10-23", "2026-10-28"), 6);
    // A month step across the spring boundary lands on the same day-of-month.
    assert.equal(addMonths("2026-04-15", -1), "2026-03-15");
  });

  it("the instant→day mapping flips at LOCAL midnight on both boundary days", () => {
    // 23:30 on 2026-03-26 is 21:30Z (+02:00); 00:30 on 2026-03-27 is 22:30Z.
    assert.equal(businessDay(new Date("2026-03-26T21:30:00Z")), "2026-03-26");
    assert.equal(businessDay(new Date("2026-03-26T22:30:00Z")), "2026-03-27");
    // 01:30 on 2026-10-25 is still +03:00, i.e. 22:30Z on the 24th.
    assert.equal(businessDay(new Date("2026-10-24T20:30:00Z")), "2026-10-24");
    assert.equal(businessDay(new Date("2026-10-24T22:30:00Z")), "2026-10-25");
  });

  it("resolvePeriod over a DST boundary reports the right day COUNT and the right instants", () => {
    const spring = resolvePeriod({
      startDate: "2026-03-25",
      endDate: "2026-03-30",
      now: new Date("2026-03-30T09:00:00Z"),
    });
    assert.equal(spring.days, 6);
    assert.equal(spring.fromTs.toISOString(), "2026-03-24T22:00:00.000Z");
    assert.equal(spring.toTsExclusive.toISOString(), "2026-03-30T21:00:00.000Z");
    // Six civil days across spring-forward is 6*24 - 1 hours of wall clock.
    assert.equal((spring.toTsExclusive.getTime() - spring.fromTs.getTime()) / 3600000, 6 * 24 - 1);

    const autumn = resolvePeriod({
      startDate: "2026-10-23",
      endDate: "2026-10-28",
      now: new Date("2026-10-28T09:00:00Z"),
    });
    assert.equal(autumn.days, 6);
    assert.equal((autumn.toTsExclusive.getTime() - autumn.fromTs.getTime()) / 3600000, 6 * 24 + 1);
  });
});

// ===========================================================================
// §5.0(9) — the build-time sweep over EVERY builder in QUERY_BUILDERS
// ===========================================================================

describe("stage 5 — §5.0(9) every range probe keeps its NOT <alias>.is_terminal", () => {
  const PROBE = /\b([A-Za-z_][A-Za-z0-9_]*)\.valid_range\s*(@>|&&)/g;

  it("the catalogue covers every builder in QUERY_BUILDERS, and every SHAPE of it", () => {
    const built = allBuiltStatements();
    const labels = built.map((b) => b.sql.slice(3, b.sql.indexOf("\n")));
    for (const key of Object.keys(QUERY_BUILDERS)) {
      assert.ok(
        labels.some((l) => l.startsWith(key + " ")),
        `${key} is in QUERY_BUILDERS but nothing in allBuiltStatements() builds it`,
      );
    }
    // Q4's shape changes with the dimension and the family, Q5's with the
    // dimension, Q7's with the entity: 1+1+1+1 + 8*2 + 7 + 1 + 3 + 1 = 32.
    assert.equal(built.length, 32);
  });

  it("guardAllBuilders() passes on the shipped text", () => {
    assert.doesNotThrow(() => guardAllBuilders());
  });

  it("EVERY guard in EVERY statement is load-bearing — remove one and the lint fires", () => {
    const built = allBuiltStatements();
    let guardedProbes = 0;
    let unprobedGuards = 0;

    for (const b of built) {
      const label = b.sql.slice(3, b.sql.indexOf("\n"));
      // Every `NOT <alias>.is_terminal` in the statement, deleted one at a time.
      const guards = [...b.sql.matchAll(/NOT\s+([A-Za-z_][A-Za-z0-9_]*)\.is_terminal\b/g)];
      for (const g of guards) {
        const alias = g[1];
        const at = g.index ?? 0;
        const without = b.sql.slice(0, at) + b.sql.slice(at + g[0].length);
        // The guard only matters where the SAME alias also carries a range
        // probe. Q4 and Q6 carry `NOT i.is_terminal` with no probe at all, and
        // the lint has — correctly — nothing to say about those.
        PROBE.lastIndex = 0;
        const probed = [...b.sql.matchAll(PROBE)].some((m) => m[1] === alias);
        if (!probed) {
          unprobedGuards++;
          assert.doesNotThrow(
            () => guardRangeProbes(without, label),
            `${label}: ${alias} carries no range probe, so removing its guard must NOT fire the lint`,
          );
          continue;
        }
        guardedProbes++;
        assert.throws(
          () => guardRangeProbes(without, label),
          new RegExp(`range probe on ${alias}\\.valid_range`),
          `${label}: NOT ${alias}.is_terminal at offset ${at} can be deleted and the §5.0(9) lint does not notice`,
        );
      }
    }

    // Q3 alone carries five probes all aliased `q`, and the whole point of the
    // clause-scoped lint is that each of the five is checked on its own — so
    // the count here is well above one guard per statement.
    assert.ok(guardedProbes >= 12, `expected many guarded probes, found ${guardedProbes}`);
    assert.ok(unprobedGuards > 0, "expected at least one is_terminal that guards no probe");
  });

  it("the Q3 repeated-alias case specifically: one surviving guard does not cover the others", () => {
    // Q3 is the statement the clause-scoped lint exists for: it is the one that
    // aliases the interval `q` in more than one place, so the first version of
    // the guard — a search of the whole statement text — was satisfied by any
    // single survivor and the rest could be deleted in silence.
    //
    // The count is 2, not the 4 it was: Q3's three correlated queue subqueries
    // had an identical WHERE and differed only in their aggregate, which cost
    // 358,562 and pulled the statement over jit_above_cost, and they are now one
    // grouped CTE. Two `q` probes in two separate CTE bodies still make the
    // point — the property under test is that a guard covers its OWN clause and
    // nothing else, not how many clauses there happen to be.
    const sql = QUERY_BUILDERS.Q3().sql;
    const guards = [...sql.matchAll(/NOT\s+q\.is_terminal\b/g)];
    assert.equal(guards.length, 2);
    assert.equal([...sql.matchAll(/\bq\.valid_range\s*@>/g)].length, 2);
    for (const g of guards) {
      const at = g.index ?? 0;
      const without = sql.slice(0, at) + sql.slice(at + g[0].length);
      assert.throws(
        () => guardRangeProbes(without, "Q3 stationBoard"),
        /range probe on q\.valid_range/,
      );
    }
  });
});

// ===========================================================================
// The fixture
// ===========================================================================

/** One dedicated lock for every suite that truncates the ledger. */
const LEDGER_TRUNCATE_LOCK = 526050825;

const CUSTOMER = 7701;
const SHIPMENT = 7801;
const SHIPMENT_AMOUNT = 12;
const IT_STD = 7901; // route_steps {TY_A, TY_B}
const IT_RES = 7902; // route_steps {TY_A, TY_R}
const TY_A = 7010;
const TY_B = 7020;
const TY_R = 7030;
const ST_A = 7101; // TY_A
const ST_B = 7102; // TY_B
const ST_R = 7103; // TY_R, is_research
const WORKER_A = 7201;
const WORKER_B = 7202;
const WORKER_A_NAME = "בודק א";
const WORKER_B_NAME = "בודק ב";

const DAY_WORK_SECONDS = 8 * 3600; // the 08:00-16:00 span of every fixture day

type Ev = {
  key: string;
  item: number;
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

/** One item's whole life, in the order the write path would have emitted it. */
type ItemPlan = {
  id: number;
  itemType: number;
  /** item_routes.current_status at the end — kept in step with the ledger so
   *  the deferred drift detector (§3.8) has nothing to say about the fixture. */
  finalStatus: number;
  events: Array<Omit<Ev, "item">>;
};

describe("stage 5 — the read path against a deterministic ledger", { skip: skipReason() }, () => {
  let pool: Pool;
  /** Holds the truncate lock for the life of the file. */
  let lockClient: import("pg").PoolClient;
  let routes: Record<string, (req: Request) => Promise<Response>>;
  let prisma: { $disconnect: () => Promise<void> } & MetricsClient;

  /** today, and the fixture's day labels D0 (today) .. D20. */
  const T = () => todayBusinessDay();
  const D = (n: number) => addDays(T(), -n);

  /** The default window every converted screen opens on: last 30 days. */
  const windowFrom = () => addDays(T(), -29);
  const windowTo = () => T();

  /** occurred_at of every seeded event, by key — the fixture's ground truth for
   *  the wall clock, read back from Postgres so a DST day cannot make a
   *  hardcoded "21 hours" wrong. */
  const evAt = new Map<string, Date>();
  const secondsBetween = (a: string, b: string) =>
    (evAt.get(b)!.getTime() - evAt.get(a)!.getTime()) / 1000;

  const PLAN: ItemPlan[] = [
    // ---- 7301: a full two-step run, closed. The queued step-2 interval spans
    // a night, which is the fixture's one source of off-hours time.
    {
      id: 7301,
      itemType: IT_STD,
      finalStatus: 3,
      events: [
        { key: "7301-a", day: D(20), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7301-b", day: D(20), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7301-c", day: D(20), hhmm: "12:00", to: "queued", step: 2, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
        { key: "7301-d", day: D(19), hhmm: "09:00", to: "testing", step: 2, station: ST_B, stationType: TY_B, worker: WORKER_B, reason: "test_started" },
        { key: "7301-e", day: D(19), hhmm: "11:30", to: "done", step: 2, station: null, stationType: null, worker: WORKER_B, reason: "result_submitted", submit: true },
      ],
    },
    // ---- 7302: the research path, closed. Produces the only closed
    // queued_research / in_research pair, and the only `returned_to_route`.
    {
      id: 7302,
      itemType: IT_RES,
      finalStatus: 3,
      events: [
        { key: "7302-a", day: D(15), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7302-b", day: D(15), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7302-c", day: D(15), hhmm: "11:00", to: "queued_research", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "sent_to_research", submit: true },
        { key: "7302-d", day: D(15), hhmm: "13:00", to: "in_research", step: 1, station: ST_R, stationType: TY_R, worker: WORKER_B, reason: "test_started" },
        { key: "7302-e", day: D(15), hhmm: "15:00", to: "queued", step: 2, station: null, stationType: null, worker: WORKER_B, reason: "returned_to_route", submit: true },
        { key: "7302-f", day: D(14), hhmm: "09:00", to: "testing", step: 2, station: ST_R, stationType: TY_R, worker: WORKER_B, reason: "test_started" },
        { key: "7302-g", day: D(14), hhmm: "11:00", to: "done", step: 2, station: null, stationType: null, worker: WORKER_B, reason: "result_submitted", submit: true },
      ],
    },
    // ---- 7303: open `testing` at ST_A — the live board's in_test for TY_A.
    {
      id: 7303,
      itemType: IT_STD,
      finalStatus: 1,
      events: [
        { key: "7303-a", day: D(2), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7303-b", day: D(2), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
      ],
    },
    // ---- 7304: open `testing` at ST_B, reached through a completed step 1.
    {
      id: 7304,
      itemType: IT_STD,
      finalStatus: 1,
      events: [
        { key: "7304-a", day: D(2), hhmm: "08:30", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7304-b", day: D(2), hhmm: "09:30", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7304-c", day: D(2), hhmm: "11:00", to: "queued", step: 2, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
        { key: "7304-d", day: D(2), hhmm: "12:00", to: "testing", step: 2, station: ST_B, stationType: TY_B, worker: WORKER_B, reason: "test_started" },
      ],
    },
    // ---- 7305: open `in_research` at ST_R.
    {
      id: 7305,
      itemType: IT_RES,
      finalStatus: 5,
      events: [
        { key: "7305-a", day: D(3), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7305-b", day: D(3), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7305-c", day: D(3), hhmm: "11:00", to: "queued_research", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "sent_to_research", submit: true },
        { key: "7305-d", day: D(3), hhmm: "12:00", to: "in_research", step: 1, station: ST_R, stationType: TY_R, worker: WORKER_B, reason: "test_started" },
      ],
    },
    // ---- 7306/7307/7308: one open `queued` per station TYPE, so every row of
    // the live board has a standing queue and an age to report.
    {
      id: 7306,
      itemType: IT_STD,
      finalStatus: 2,
      events: [
        { key: "7306-a", day: D(1), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
      ],
    },
    {
      id: 7307,
      itemType: IT_STD,
      finalStatus: 2,
      events: [
        { key: "7307-a", day: D(4), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7307-b", day: D(4), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7307-c", day: D(4), hhmm: "12:00", to: "queued", step: 2, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
      ],
    },
    {
      id: 7308,
      itemType: IT_RES,
      finalStatus: 2,
      events: [
        { key: "7308-a", day: D(4), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7308-b", day: D(4), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7308-c", day: D(4), hhmm: "12:00", to: "queued", step: 2, station: null, stationType: null, worker: WORKER_A, reason: "result_submitted", submit: true },
      ],
    },
    // ---- 7309: the station-less research pool, open.
    {
      id: 7309,
      itemType: IT_RES,
      finalStatus: 4,
      events: [
        { key: "7309-a", day: D(5), hhmm: "09:00", to: "queued", step: 1, station: null, stationType: null, worker: null, reason: "item_created" },
        { key: "7309-b", day: D(5), hhmm: "10:00", to: "testing", step: 1, station: ST_A, stationType: TY_A, worker: WORKER_A, reason: "test_started" },
        { key: "7309-c", day: D(5), hhmm: "11:00", to: "queued_research", step: 1, station: null, stationType: null, worker: WORKER_A, reason: "sent_to_research", submit: true },
      ],
    },
  ];

  const workerName = (id: number | null) =>
    id === WORKER_A ? WORKER_A_NAME : id === WORKER_B ? WORKER_B_NAME : null;

  async function q<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    return (await pool.query(sql, params)).rows as T[];
  }

  // -------------------------------------------------------------------------
  // setup / teardown
  // -------------------------------------------------------------------------

  before(async () => {
    // MUST precede the dynamic imports below: src/app/lib/prisma.ts builds its
    // Pool from process.env.DATABASE_URL at module-evaluation time and every
    // route module imports it transitively.
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    // The auth stub. Seeded into require.cache BEFORE withAuth (and therefore
    // the real auth.ts) is ever resolved; see the header for why this is the
    // only way to reach a withAuth-wrapped handler in-process.
    const req = createRequire(path.resolve(process.cwd(), "package.json"));
    const authPath = req.resolve("./auth.ts");
    const CjsModule = req("node:module") as any;
    const stub = new CjsModule(authPath, null);
    stub.filename = authPath;
    stub.loaded = true;
    stub.exports = {
      auth: async () => ({
        user: { name: "read-path suite", email: "readpath@example.local" },
        roles: ["manager"],
      }),
      handlers: {},
      signIn: () => {},
      signOut: () => {},
    };
    req.cache[authPath] = stub;

    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
    await assertLedgerSchemaPresent();

    // Held for the whole file: write-path.integration.test.ts truncates the
    // same tables and `node --test` runs the two files in parallel.
    lockClient = await pool.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [LEDGER_TRUNCATE_LOCK]);

    const [kpis, byStation, statusDist, statusHist, shipments, itemTypes, customers, slow, avgTimes, completion] =
      await Promise.all([
        import("../../../api/dashboard/tests/kpis/route"),
        import("../../../api/dashboard/tests/by-station/route"),
        import("../../../api/dashboard/tests/status-distribution/route"),
        import("../../../api/dashboard/tests/status-distribution/history/route"),
        import("../../../api/dashboard/tests/shipments/route"),
        import("../../../api/dashboard/tests/item-types/route"),
        import("../../../api/dashboard/tests/customer-performance/route"),
        import("../../../api/dashboard/tests/slow-items/route"),
        import("../../../api/dashboard/tests/average-times/route"),
        import("../../../api/dashboard/stats/completion-history/route"),
      ]);
    routes = {
      "tests/kpis": kpis.GET as never,
      "tests/by-station": byStation.GET as never,
      "tests/status-distribution": statusDist.GET as never,
      "tests/status-distribution/history": statusHist.GET as never,
      "tests/shipments": shipments.GET as never,
      "tests/item-types": itemTypes.GET as never,
      "tests/customer-performance": customers.GET as never,
      "tests/slow-items": slow.GET as never,
      "tests/average-times": avgTimes.GET as never,
      "stats/completion-history": completion.GET as never,
    };
    prisma = (await import("../../prisma")).prisma as never;
  });

  after(async () => {
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
    // metric_state holds six rows, below autovacuum's analyze threshold, and
    // without stats Q2א's LATERAL is planned as a merge join. Cheap here, and
    // it keeps a slow plan from being mistaken for a slow query.
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
    // item_state_event is append-only: trg_ise_immutable RAISEs on TRUNCATE as
    // well as UPDATE/DELETE. Lifting it for the wipe is the only place this
    // suite touches that trigger.
    await q("ALTER TABLE item_state_event DISABLE TRIGGER trg_ise_immutable");
    try {
      await q(`TRUNCATE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`);
    } finally {
      await q("ALTER TABLE item_state_event ENABLE TRIGGER trg_ise_immutable");
    }
  }

  /**
   * The whole fixture in ONE transaction.
   *
   * Not for speed: the drift CONSTRAINT TRIGGER (dropped by migration B) was DEFERRABLE INITIALLY DEFERRED
   * constraint trigger that compares the committed item_routes row against the
   * item's open ledger interval. Seeding item_routes in its own transaction
   * would commit a row whose legacy status has no ledger state yet and leave a
   * drift row behind for the next reader to puzzle over; inside one transaction
   * the two agree at commit and the detector stays silent — which is also the
   * cheapest possible proof that the fixture is a legal ledger state.
   */
  async function seedFixture(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        "INSERT INTO customers (id, name, customer_code) VALUES ($1, 'לקוח קריאה', 'CUST-READ')",
        [CUSTOMER],
      );
      // finished_at + shipment_date are both set, so the §5.8 ship-turnaround
      // pair has a real answer on BOTH clocks; is_sent stays false so the
      // shipment survives the default `open_shipments` scope.
      await client.query(
        `INSERT INTO shipments (id, shipment_code, customer_id, shipment_date, makat, amount, is_sent, finished_at)
         VALUES ($1, 'SHIP-READ', $2,
                 ($3::text || ' 08:00')::timestamp,
                 'MK-READ', $4, false,
                 ($5::text || ' 12:00')::timestamp AT TIME ZONE 'Asia/Jerusalem')`,
        [SHIPMENT, CUSTOMER, D(25), SHIPMENT_AMOUNT, D(10)],
      );
      await client.query(
        "INSERT INTO item_types (item_type_id, item_type_desc) VALUES ($1, 'סטנדרטי'), ($2, 'מחקרי')",
        [IT_STD, IT_RES],
      );
      await client.query(
        `INSERT INTO test_stations_type (test_station_type_id, test_type_desc, parents_only) VALUES
           ($1, 'קליטה', false), ($2, 'תפקודית', false), ($3, 'מחקר', false)`,
        [TY_A, TY_B, TY_R],
      );
      await client.query(
        `INSERT INTO test_stations (test_station_id, test_station_type_id, test_station_desc, status, is_research) VALUES
           ($1, $4, 'עמדה א', 2, false),
           ($2, $5, 'עמדה ב', 2, false),
           ($3, $6, 'מעבדת מחקר', 2, true)`,
        [ST_A, ST_B, ST_R, TY_A, TY_B, TY_R],
      );
      await client.query(
        `INSERT INTO testing_routes (item_type_id, test_station_type_id, route_steps, route_number) VALUES
           ($1, $3, ARRAY[$3::int, $4::int], 1),
           ($2, $3, ARRAY[$3::int, $5::int], 1)`,
        [IT_STD, IT_RES, TY_A, TY_B, TY_R],
      );

      // The work calendar: 08:00-16:00 Asia/Jerusalem on EVERY day of the
      // horizon, so a whole day is 28,800 work-seconds and every fixture event
      // sits inside a span. The ladder (cum_seconds_before) is what
      // work_seconds_elapsed reads.
      //
      // THE HORIZON REACHES 120 DAYS FORWARD, and that is not padding. This is
      // the database's ONE current calendar while the suite runs, and
      // POST /api/cron/metrics-selfcheck — which observability.integration.test.ts
      // exercises in a parallel process — self-heals whenever the horizon is
      // under HEAL_HORIZON_DAYS (60). A 30-day fixture horizon made that route
      // dynamically import the @hebcal/core calendar builder, which is ESM-only
      // and does not resolve under tsx's CJS require, and the other suite went
      // red for a reason that had nothing to do with it.
      const horizonTo = addDays(T(), 120);
      const [{ calendar_version: ver }] = (
        await client.query(
          `INSERT INTO work_calendar_version (horizon_from, horizon_to, source_digest, is_current)
           VALUES ($1::date, $2::date, 'read-path-fixture-0800-1600', true)
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
           VALUES ($1, $2, $3, $4, $5, 'MODEL-READ', 'MFR', 'MFR-NO', $6, NULL)`,
          [plan.id, CUSTOMER, plan.itemType, `SN-${plan.id}`, `MK-${plan.id}`, SHIPMENT],
        );
        await client.query(
          `INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step,
                                    test_station_id, created_at, is_finished, queue_start_time, route_number)
           VALUES ($1, $2, $3, 1, NULL,
                   ($4::text || ' ' || $5::text)::timestamp, $6,
                   ($4::text || ' ' || $5::text)::timestamp, 1)`,
          [plan.id, plan.itemType, plan.finalStatus, first.day, first.hhmm, plan.finalStatus === 3],
        );

        // The real fold opens the run; every event below is applied by
        // trg_isi_apply exactly as the write path would apply it.
        const [{ route_run_id: run }] = (
          await client.query(
            `SELECT metrics_open_run($1::bigint,
                    ($2::text || ' ' || $3::text)::timestamp AT TIME ZONE 'Asia/Jerusalem') AS route_run_id`,
            [plan.id, first.day, first.hhmm],
          )
        ).rows;

        for (const e of plan.events) {
          const [{ event_id, occurred_at }] = (
            await client.query(
              `INSERT INTO item_state_event
                 (event_key, route_run_id, item_id, occurred_at, seq, kind, to_state, step_no,
                  station_id, station_type_id, worker_id, worker_name, reason, submit_id)
               VALUES ($1, $2, $3,
                       ($4::text || ' ' || $5::text)::timestamp AT TIME ZONE 'Asia/Jerusalem',
                       0, 'transition', $6, $7, $8, $9, $10, $11, $12,
                       CASE WHEN $13::boolean THEN gen_random_uuid() END)
               RETURNING event_id, occurred_at`,
              [
                e.key, run, plan.id, e.day, e.hhmm, e.to, e.step,
                e.station, e.stationType, e.worker, workerName(e.worker), e.reason,
                e.submit === true,
              ],
            )
          ).rows;
          evAt.set(e.key, new Date(occurred_at));
          // §5.9's fail_pct reads test_results through the EXIT event of the
          // active-work interval, so the two rows are hung on the events that
          // closed a test — one pass, one fail.
          if (e.key === "7301-e" || e.key === "7304-c") {
            const passed = e.key === "7301-e";
            const prev = plan.events[plan.events.indexOf(e) - 1];
            await client.query(
              `INSERT INTO test_results (item_id, test_station_id, test_station_type_id, route_number,
                                         route_step, worker_id, passed, state_event_id)
               VALUES ($1, $2, $3, 1, $4, $5, $6, $7)`,
              [plan.id, prev.station, prev.stationType, prev.step, e.worker, passed, event_id],
            );
          }
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
  // The fixture is a legal ledger state
  // -------------------------------------------------------------------------

  it("fixture sanity: the fold produced the intervals the write path would have, and no drift", async () => {
    const [{ n: drift }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n
           FROM item_routes ir
           LEFT JOIN item_state_interval i
                  ON i.item_id = ir.item_id AND upper_inf(i.valid_range)
          WHERE EXISTS (SELECT 1 FROM item_state_interval x WHERE x.item_id = ir.item_id)
            AND i.state_key IS DISTINCT FROM state_of(ir.current_status)`,
    );
    assert.equal(drift, 0);

    // §3.6 / §5.4: a `queued` interval carries the station TYPE it waits for
    // and NEVER a station_id — the fact that made the by-station waiting family
    // structurally null when it was grouped by station.
    const [{ with_station: queuedWithStation, n: queuedRows }] = await q<{ with_station: number; n: number }>(
      `SELECT count(*) FILTER (WHERE station_id IS NOT NULL)::int AS with_station,
              count(*)::int AS n
         FROM item_state_interval WHERE state_key = 'queued'`,
    );
    assert.equal(queuedWithStation, 0);
    assert.equal(queuedRows, 11 + 3); // 11 closed + 3 still open
    const [{ n: qrWithType }] = await q<{ n: number }>(
      `SELECT count(*) FILTER (WHERE station_type_id IS NOT NULL)::int AS n
         FROM item_state_interval WHERE state_key = 'queued_research'`,
    );
    assert.equal(qrWithType, 0);

    // Both clocks are written on every closed non-terminal interval, and the
    // work clock never overtakes the wall clock (§2.8).
    const [{ n: missing }] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM item_state_interval
        WHERE closed_at IS NOT NULL AND NOT is_terminal
          AND (wall_seconds IS NULL OR work_seconds IS NULL OR work_seconds > wall_seconds)`,
    );
    assert.equal(missing, 0);

    // The 08:00-16:00 calendar, checked once on the one interval that spans a
    // night: 12:00→16:00 on D20 plus 08:00→09:00 on D19 = 5 work hours.
    const [{ work_seconds: overnightWork, wall_seconds: overnightWall }] = await q<{
      work_seconds: number;
      wall_seconds: number;
    }>(
      `SELECT work_seconds, wall_seconds FROM item_state_interval
        WHERE item_id = 7301 AND state_key = 'queued' AND step_no = 2`,
    );
    assert.equal(overnightWork, 5 * 3600);
    assert.equal(overnightWall, secondsBetween("7301-c", "7301-d"));
    assert.ok(overnightWall > overnightWork, "the overnight queue must carry off-hours time");
  });

  // -------------------------------------------------------------------------
  // Golden rows, Q1..Q8
  // -------------------------------------------------------------------------

  it("Q1 (§5.2) point-in-time is the ACTIVE population, with the share computed in SQL", async () => {
    const rows = await pointInTime(prisma, new Date());
    // `done` is not a slice: 7301 and 7302 are finished and do not appear.
    assert.deepEqual(
      rows.map((r) => [r.state_key, r.items, r.units]),
      [
        ["testing", 2, 2], // 7303 @ST_A, 7304 @ST_B
        ["queued", 3, 3], // 7306 TY_A, 7307 TY_B, 7308 TY_R
        ["queued_research", 1, 1], // 7309
        ["in_research", 1, 1], // 7305 @ST_R
      ],
    );
    // The share is over the 7 rows the query itself counted, never a second
    // query's total, and it sums to 100.
    assert.deepEqual(rows.map((r) => r.pct), [28.6, 42.9, 14.3, 14.3]);
    assert.equal(rows.reduce((a, r) => a + r.items, 0), 7);
  });

  it("Q2א (§5.3) samples the grid at 12:00 and carries nothing forward", async () => {
    const rows = await pitSeries(prisma, D(20), T());
    const on = (day: string) =>
      Object.fromEntries(rows.filter((r) => r.business_day === day).map((r) => [r.state_key, r.items]));

    // Today: the same live population Q1 reports.
    assert.deepEqual(on(T()), { testing: 2, queued: 3, queued_research: 1, in_research: 1, unmapped: 0 });
    // D17 sits between 7301's closure (D19) and 7302's first event (D15): the
    // lab is empty, and §5.0(7) says that is a row of zeros, not a gap and not
    // yesterday's numbers repeated.
    assert.deepEqual(on(D(17)), { testing: 0, queued: 0, queued_research: 0, in_research: 0, unmapped: 0 });
    // D20 at 12:00 — 7301 has just moved from testing to its step-2 queue.
    assert.deepEqual(on(D(20)), { testing: 0, queued: 1, queued_research: 0, in_research: 0, unmapped: 0 });
    // Every grid day is present for every non-terminal state, `done` for none.
    assert.equal(rows.length, 21 * 5);
    assert.equal(rows.filter((r) => r.state_key === "done").length, 0);
  });

  it("Q2ב (§5.3ב) counts route_run closures, additively, on the day they happened", async () => {
    const { rows } = await finishedCumulative(prisma, D(20), T());
    const byDay = new Map(rows.map((r) => [r.business_day, r]));
    assert.equal(byDay.get(D(20))!.finished_today, 0);
    assert.equal(byDay.get(D(19))!.finished_today, 1); // 7301
    assert.equal(byDay.get(D(14))!.finished_today, 1); // 7302
    assert.equal(byDay.get(D(19))!.finished_cumulative, 1);
    assert.equal(byDay.get(D(15))!.finished_cumulative, 1);
    assert.equal(byDay.get(T())!.finished_cumulative, 2);
    assert.equal(rows.reduce((a, r) => a + r.finished_today, 0), 2);

    const w = await finishedInWindow(prisma, windowFrom(), windowTo());
    // D19 and D14 are both inside the default 30-day window.
    assert.equal(w.finished_runs, 2);
    assert.deepEqual(w.ignoredFilters, []);
  });

  it("Q3 (§5.4) the live board: the queue belongs to the TYPE and research is a station-less pool", async () => {
    const board = await stationBoard(prisma);
    assert.deepEqual(board.map((b) => b.test_station_id), [ST_A, ST_B, ST_R]);
    const by = new Map(board.map((b) => [b.test_station_id, b]));

    assert.equal(by.get(ST_A)!.in_test, 1); // 7303
    assert.equal(by.get(ST_B)!.in_test, 1); // 7304
    assert.equal(by.get(ST_R)!.in_test, 0);
    assert.equal(by.get(ST_R)!.in_research, 1); // 7305
    // One open `queued` per type, reported on that type's station.
    assert.equal(by.get(ST_A)!.shared_type_queue, 1); // 7306 waits for TY_A
    assert.equal(by.get(ST_B)!.shared_type_queue, 1); // 7307 waits for TY_B
    assert.equal(by.get(ST_R)!.shared_type_queue, 1); // 7308 waits for TY_R
    // The research pool has no station, so every row reports the same count and
    // the column must never be summed down the table (§5.4).
    assert.deepEqual(board.map((b) => b.research_pool_queue), [1, 1, 1]);

    for (const b of board) {
      // Both ages exist on both clocks for every station, and the work clock
      // never runs ahead of the wall clock.
      assert.ok(b.standing_queue_age_wall_min !== null, `${b.test_station_id} standing wall`);
      assert.ok(b.standing_queue_age_work_min !== null, `${b.test_station_id} standing work`);
      assert.ok(b.active_test_age_wall_min !== null, `${b.test_station_id} active wall`);
      assert.ok(b.active_test_age_work_min !== null, `${b.test_station_id} active work`);
      assert.ok(b.standing_queue_age_work_min! <= b.standing_queue_age_wall_min! + 1e-6);
      assert.ok(b.active_test_age_work_min! <= b.active_test_age_wall_min! + 1e-6);
    }
  });

  it("Q4 (§5.5) flow by station: 'processed' includes research diversions and returns", async () => {
    const rows = await flow(prisma, windowFrom(), windowTo(), {}, {
      dimension: "station",
      byDay: false,
    });
    const by = new Map(rows.map((r) => [r.station_id, r]));

    const a = by.get(ST_A)!;
    // Seven closed tests at ST_A; 7303's is still open and is not "processed".
    assert.equal(a.steps_processed, 7);
    assert.equal(a.steps_completed, 4); // 7301, 7304, 7307, 7308
    assert.equal(a.diverted_to_research, 3); // 7302, 7305, 7309
    assert.equal(a.abandonments, 0);
    assert.equal(a.n, 7);
    assert.equal(a.work_hours, 10.5); // 2 + 1 + 1.5 + 1 + 2 + 2 + 1
    assert.equal(a.wall_hours, 10.5); // every one of them inside a work span
    assert.equal(a.max_work_min, 120);
    assert.equal(a.station_type_id, TY_A);
    // §5.0(6): unit_id is not a legal de-duplication key under a station, so
    // the column is not emitted at all rather than emitted and annotated.
    assert.equal(a.units_processed, undefined);

    const b = by.get(ST_B)!;
    assert.equal(b.steps_processed, 1); // 7301 step 2
    assert.equal(b.work_hours, 2.5);

    const r = by.get(ST_R)!;
    // The research station's two closures: the in_research treatment (which
    // ends in returned_to_route) and the step-2 test. The old query counted
    // only result_submitted and would have reported 1.
    assert.equal(r.steps_processed, 2);
    assert.equal(r.returned_from_research, 1);
    assert.equal(r.steps_completed, 1);
    assert.equal(r.work_hours, 4);
  });

  it("Q4 waiting family groups by station TYPE, and the research pool lands in its own row", async () => {
    const rows = await flow(prisma, windowFrom(), windowTo(), {}, {
      dimension: "station_type",
      family: "waiting",
      byDay: false,
    });
    const by = new Map(rows.map((r) => [r.station_type_id, r]));

    // Eight closed step-1 queues waiting for TY_A, one hour each.
    assert.equal(by.get(TY_A)!.steps_processed, 8);
    assert.equal(by.get(TY_A)!.work_hours, 8);
    // TY_B: 7301's overnight queue (5 work hours) and 7304's one hour.
    assert.equal(by.get(TY_B)!.steps_processed, 2);
    assert.equal(by.get(TY_B)!.work_hours, 6);
    // TY_R: 7302's queue for its research step — 15:00→16:00 plus 08:00→09:00.
    assert.equal(by.get(TY_R)!.steps_processed, 1);
    assert.equal(by.get(TY_R)!.work_hours, 2);
    // queued_research carries no station type at all, so it groups under NULL
    // and cannot be attributed to a station type without inventing one.
    assert.equal(by.get(null)!.steps_processed, 2); // 7302 (2h) and 7305 (1h)
    assert.equal(by.get(null)!.work_hours, 3);
  });

  it("Q5 (§5.6) clips every interval to the window and keeps the ones still open", async () => {
    const period = resolvePeriod({ startDate: windowFrom(), endDate: windowTo() });
    const k = await kpiWindowOne(prisma, period.fromTs, period.toTsExclusive);

    // 11 closed queues + 3 open + 2 closed research queues + 1 open = 17.
    assert.equal(k.wait_n, 17);
    // 10 closed tests/treatments + 3 still running = 13.
    assert.equal(k.busy_n, 13);
    assert.equal(k.units_touched, 9);
    // The off-hours total is the fixture's one overnight queue plus whatever
    // the three open intervals have accumulated outside 08:00-16:00, so it is
    // at least the 16 hours of that one interval.
    assert.ok(k.offhours_min !== null);
    assert.ok(k.offhours_min! >= 16 * 60, `offhours_min = ${k.offhours_min}`);
    // Research reads on both clocks. The mean is over THREE waits, not two:
    // 7302 waited 120 minutes and 7305 waited 60, and 7309 is still waiting —
    // §5.6 keeps an interval that is open at the far edge and clips it at now()
    // rather than dropping it, so the mean sits above the closed-only 90. That
    // is the difference between this KPI and Q8's, which averages closed rows.
    assert.ok(k.avg_research_wait_wall_min !== null && k.avg_research_wait_work_min !== null);
    assert.ok(
      k.avg_research_wait_wall_min! > 90,
      `the still-open research wait must pull the mean up, got ${k.avg_research_wait_wall_min}`,
    );
    assert.ok(k.avg_research_wait_work_min! <= k.avg_research_wait_wall_min! + 1e-6);
    assert.ok(k.avg_research_wall_min !== null && k.avg_research_work_min !== null);
    assert.ok(k.avg_wait_work_min! <= k.avg_wait_wall_min! + 1e-6);
    assert.ok(k.avg_busy_work_min! <= k.avg_busy_wall_min! + 1e-6);
  });

  it("Q6 (§5.7) ranks by the WORK clock and reports the step, not the item's current station", async () => {
    const rows = await slowSteps(prisma, windowFrom(), windowTo(), {}, 20);
    const top = rows[0];
    // 7301's step 2: 300 work-minutes queued overnight plus 150 tested.
    assert.equal(top.item_id, 7301);
    assert.equal(top.step_no, 2);
    assert.equal(top.attempt_no, 1);
    assert.equal(top.station_name, "עמדה ב");
    assert.equal(top.worker_id, WORKER_B);
    assert.equal(top.worker_name, WORKER_B_NAME);
    assert.equal(top.queue_work_min, 300);
    assert.equal(top.test_work_min, 150);
    assert.equal(top.total_work_min, 450);
    // The LATERAL found the preceding queue exactly, so the wall clock is the
    // instants the fixture wrote — 21 hours of queue plus 2.5 of test.
    assert.equal(
      Math.round(top.total_wall_min! * 60),
      secondsBetween("7301-c", "7301-d") + secondsBetween("7301-d", "7301-e"),
    );
    assert.ok(top.total_work_min! < top.total_wall_min!);
    assert.equal(top.serial_no, "SN-7301");
    assert.equal(top.makat, "MK-7301");
    // Ordered by the work clock, descending, with no nulls in front.
    const order = rows.map((r) => r.total_work_min ?? -1);
    assert.deepEqual(order, [...order].sort((x, y) => y - x));
    // Ten closed active-work intervals in the window, none of them accessories.
    assert.equal(rows.length, 10);
  });

  it("Q7 (§5.8) shipment progress: completion is finished/routed, coverage is its own number", async () => {
    const [s] = await entityProgress(prisma, "shipment");
    assert.equal(s.entity_id, SHIPMENT);
    assert.equal(s.routed_runs, 9);
    assert.equal(s.routed_units, 9);
    assert.equal(s.finished_runs, 2);
    // The open intervals of each run, one lateral row per run.
    assert.equal(s.in_queue, 3);
    assert.equal(s.in_test, 2);
    assert.equal(s.waiting_research, 1);
    assert.equal(s.in_research, 1);
    assert.equal(s.finished, 2); // the two `done` intervals, which stay open
    assert.equal(s.completion_pct, 22.2); // 2 / 9
    // shipments.amount is a STOCK number and is never the completion
    // denominator; it is the coverage denominator and nothing else.
    assert.equal(s.declared_amount, SHIPMENT_AMOUNT);
    assert.equal(s.coverage_pct, 75.0); // 9 routed units of 12 declared
    // Turnaround: 7301 opened D20 09:00 and closed D19 11:30 (630 work-min),
    // 7302 opened D15 09:00 and closed D14 11:00 (600).
    assert.equal(s.avg_route_turnaround_work_min, 615);
    assert.equal(
      Math.round(s.avg_route_turnaround_wall_min! * 60),
      (secondsBetween("7301-a", "7301-e") + secondsBetween("7302-a", "7302-g")) / 2,
    );
    assert.ok(s.ship_turnaround_wall_min !== null && s.ship_turnaround_work_min !== null);
  });

  it("Q7 customer and item type: the denominator counts UNITS, and a decayed LEFT JOIN would lose a row", async () => {
    const [c] = await entityProgress(prisma, "customer");
    assert.equal(c.entity_id, CUSTOMER);
    assert.equal(c.routed_units, 9);
    assert.equal(c.declared_amount, 9); // parent items, not item rows
    assert.equal(c.coverage_pct, 100.0);
    assert.equal(c.completion_pct, 22.2);

    const types = await entityProgress(prisma, "item_type");
    const byType = new Map(types.map((r) => [r.entity_id, r]));
    // Both item types survive, which is the §9.4 defect this shape fixes.
    assert.deepEqual([...byType.keys()].sort(), [IT_STD, IT_RES]);
    assert.equal(byType.get(IT_STD)!.routed_runs, 5); // 7301,7303,7304,7306,7307
    assert.equal(byType.get(IT_STD)!.finished_runs, 1);
    assert.equal(byType.get(IT_STD)!.completion_pct, 20.0);
    assert.equal(byType.get(IT_RES)!.routed_runs, 4); // 7302,7305,7308,7309
    assert.equal(byType.get(IT_RES)!.finished_runs, 1);
    assert.equal(byType.get(IT_RES)!.completion_pct, 25.0);
    // item type counts runs, never unit_id — an accessory carries its own type.
    assert.equal(byType.get(IT_STD)!.declared_amount, 5);
    assert.equal(byType.get(IT_RES)!.declared_amount, 4);
  });

  it("Q8 (§5.9) reads pass/fail through the interval's EXIT event", async () => {
    const rows = await quality(prisma, windowFrom(), windowTo());
    const pass = rows.find((r) => r.d === D(19) && r.station_type_id === TY_B)!;
    assert.equal(pass.results_recorded, 1);
    assert.equal(pass.passed, 1);
    assert.equal(pass.failed, 0);
    assert.equal(pass.fail_pct, 0.0);

    const fail = rows.find((r) => r.d === D(2) && r.station_type_id === TY_A)!;
    assert.equal(fail.results_recorded, 1);
    assert.equal(fail.failed, 1);
    assert.equal(fail.fail_pct, 100.0);

    // The research turnaround columns are per-run lookups, so the day 7302's
    // research closed reports both clocks.
    const research = rows.find((r) => r.d === D(15) && r.station_type_id === TY_R)!;
    assert.equal(research.avg_research_wait_wall_min, 120);
    assert.equal(research.avg_research_wall_min, 120);
    // A day with tests but no recorded result reports 0 results and a NULL
    // fail_pct — never a 0% that reads as "nothing failed".
    const noResults = rows.find((r) => r.d === D(4) && r.station_type_id === TY_A)!;
    assert.equal(noResults.results_recorded, 0);
    assert.equal(noResults.fail_pct, null);
    assert.equal(noResults.rework_pct, 0);
  });

  // -------------------------------------------------------------------------
  // The converted endpoints — the invariant that caught nothing before
  // -------------------------------------------------------------------------

  /** Every converted endpoint, and the query string the screen opens with. */
  const CONVERTED = [
    "tests/kpis",
    "tests/by-station",
    "tests/status-distribution",
    "tests/status-distribution/history",
    "tests/shipments",
    "tests/item-types",
    "tests/customer-performance",
    "tests/slow-items",
    "tests/average-times",
    "stats/completion-history",
  ] as const;

  /**
   * `_new_` fields that may legitimately be null on the default window, with
   * the reason. DELIBERATELY TINY: every entry is a promise that the null
   * carries meaning. Finding #1 was four fields that were null on every row of
   * every run, and the only thing standing between that and production is how
   * short this list stays.
   */
  const NULLABLE: Record<string, Record<string, string>> = {
    "tests/kpis": {
      _new_ignoredFilters:
        "not a metric — it is the list of filters route_run cannot express, and null means every filter was honoured",
    },
    "tests/shipments": {
      _new_ignoredFilters: "same as tests/kpis — the list of dropped filters, not a number",
    },
  };

  /** The two-clock pairs whose halves do not share a stem (§2.8). One entry:
   *  the KPI card's queue wait, whose work half keeps the legacy wire name. */
  const CLOCK_PAIR_ALIAS: Record<string, string> = {
    _new_busiestStationWaitWallSeconds: "busiestStationWaitSeconds",
  };

  function defaultQuery(extra: Record<string, string> = {}): string {
    const sp = new URLSearchParams({ startDate: windowFrom(), endDate: windowTo(), ...extra });
    return sp.toString();
  }

  async function call(name: string, query = defaultQuery()): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await routes[name](new Request(`http://localhost/api/dashboard/${name}?${query}`) as never);
    return { status: res.status, body: await res.json(), headers: res.headers };
  }

  /** Every plain object in a response, however deeply nested (the history
   *  endpoint hides its rows inside `statuses`). */
  function everyRow(node: unknown, out: Array<{ path: string; row: Record<string, unknown> }> = [], p = "$"): typeof out {
    if (Array.isArray(node)) {
      node.forEach((v, i) => everyRow(v, out, `${p}[${i}]`));
    } else if (node && typeof node === "object") {
      out.push({ path: p, row: node as Record<string, unknown> });
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === "object") everyRow(v, out, `${p}.${k}`);
      }
    }
    return out;
  }

  it("every converted endpoint answers 200 on the default window and returns rows", async () => {
    for (const name of CONVERTED) {
      const { status, body } = await call(name);
      assert.equal(status, 200, `${name} answered ${status}: ${JSON.stringify(body).slice(0, 200)}`);
      const n = Array.isArray(body) ? body.length : Object.keys(body).length;
      assert.ok(n > 0, `${name} answered an empty response — the fixture should fill every screen`);
    }
  });

  it("NO _new_ field is null on ANY row of ANY converted endpoint (the finding-#1 assertion)", async () => {
    const offenders: string[] = [];
    for (const name of CONVERTED) {
      const { body } = await call(name);
      const allowed = NULLABLE[name] ?? {};
      for (const { path: p, row } of everyRow(body)) {
        for (const [k, v] of Object.entries(row)) {
          if (!k.startsWith("_new_")) continue;
          if (v !== null && v !== undefined) continue;
          if (allowed[k]) continue;
          offenders.push(`${name} ${p}.${k}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these §2.8 additions came back null on a window the fixture fills — the shape of finding #1:\n  " +
        offenders.join("\n  "),
    );
  });

  it("by-station specifically: the four waiting fields finding #1 left permanently null", async () => {
    // Named on their own because they are the ones that shipped broken, and
    // because the general assertion above would still pass if the waiting
    // family were grouped by station AND the fixture happened to have a
    // station-carrying queue interval (it cannot — but the reader should not
    // have to derive that to trust this).
    const { body } = await call("tests/by-station");
    assert.equal(body.length, 3);
    for (const row of body) {
      for (const f of [
        "_new_typeWaitWallHours",
        "_new_typeWaitWorkHours",
        "_new_typeWaitAvgWallMinutes",
        "_new_typeWaitAvgWorkMinutes",
      ]) {
        assert.ok(row[f] !== null, `${row.stationName}.${f} is null — the waiting family lost its station type again`);
      }
    }
    // The type's queue repeats across the stations of a type and is never the
    // station's own: TY_A's 8 closed queue-hours are reported on ST_A's row.
    const a = body.find((r: any) => r.stationId === ST_A)!;
    assert.equal(a._new_typeWaitWorkHours, 8);
    assert.equal(a._new_typeWaitAvgWorkMinutes, 60);
    const b = body.find((r: any) => r.stationId === ST_B)!;
    assert.equal(b._new_typeWaitWorkHours, 6);
    // ST_R's own flow numbers, from the two research closures.
    const r = body.find((r: any) => r.stationId === ST_R)!;
    assert.equal(r.totalProcessedInPeriod, 2);
    assert.equal(r._new_typeWaitWorkHours, 2);
  });

  it("§2.8 — every *Wall* field has its *Work* sibling and the work clock never overtakes it", async () => {
    const unpaired: string[] = [];
    const crossed: string[] = [];
    let pairsChecked = 0;

    for (const name of CONVERTED) {
      const { body } = await call(name);
      for (const { path: p, row } of everyRow(body)) {
        for (const [k, wall] of Object.entries(row)) {
          if (!k.includes("Wall")) continue;
          const sib = CLOCK_PAIR_ALIAS[k] ?? k.replace("Wall", "Work");
          if (!(sib in row)) {
            unpaired.push(`${name} ${p}.${k} — expected ${sib} beside it`);
            continue;
          }
          pairsChecked++;
          const work = row[sib];
          if (typeof wall === "number" && typeof work === "number" && work > wall + 1e-6) {
            crossed.push(`${name} ${p}: ${sib}=${work} > ${k}=${wall}`);
          }
        }
      }
    }

    assert.deepEqual(unpaired, [], "a duration shipped on one clock only:\n  " + unpaired.join("\n  "));
    assert.deepEqual(crossed, [], "the work clock ran past the wall clock:\n  " + crossed.join("\n  "));
    // The alias entry above is the ONLY cross-named pair; if that stops being
    // true this count moves and someone has to look.
    assert.ok(pairsChecked >= 20, `expected many two-clock pairs, checked ${pairsChecked}`);
  });

  it("the KPI card's numbers are the ledger's, and its queue pair sits on both clocks", async () => {
    const { body: k, headers } = await call("tests/kpis");
    assert.equal(k.itemsCurrentlyInQueue, 4); // 3 queued + 1 queued_research
    assert.equal(k.itemsCurrentlyInTest, 3); // 2 testing + 1 in_research
    assert.equal(k.totalItemsProcessed, 2);
    assert.equal(k.treatedCount, 2);
    // Ranked by work_hours: ST_A did 10.5 hours, ST_B 2.5, ST_R 4.
    assert.equal(k.busiestStationId, ST_A);
    assert.equal(k._new_busiestStationWorkHours, 10.5);
    assert.equal(k.busiestStationCount, 7); // steps_processed, the label's claim
    assert.equal(k.busiestStationBusySeconds, 10.5 * 3600);
    // The busiest station's TYPE queue — TY_A's 8 work-hours — on both clocks.
    assert.equal(k._new_busiestStationTypeId, TY_A);
    assert.equal(k.busiestStationWaitSeconds, 8 * 3600);
    assert.equal(k._new_busiestStationWaitWallSeconds, 8 * 3600);
    // The lab-wide total ships under its own name and is larger: every type
    // plus the station-less research pool.
    assert.equal(k._new_labWaitWorkSeconds, (8 + 6 + 2 + 3) * 3600);
    assert.ok(k._new_labWaitWallSeconds >= k._new_labWaitWorkSeconds);
    // §6.3 — the window the server actually queried, reported as headers.
    assert.equal(headers.get("x-metrics-period-from"), windowFrom());
    assert.equal(headers.get("x-metrics-period-to"), windowTo());
    assert.equal(headers.get("x-metrics-period-capped"), null);
  });

  it("average-times emits a bucket only where something closed, and both families in every one", async () => {
    const { body } = await call("tests/average-times");
    // D20, D19, D15, D14, D5, D4, D3, D2 — eight days had a closure. D1 (7306
    // arriving in the queue) is not a bucket: §5.0(7), no gap filling.
    assert.deepEqual(
      body.map((p: any) => p.date),
      [D(20), D(19), D(15), D(14), D(5), D(4), D(3), D(2)],
    );
    for (const p of body) {
      assert.ok(p.avgWaitingMinutes !== null, `${p.date} waiting`);
      assert.ok(p.avgProcessingMinutes !== null, `${p.date} processing`);
      assert.ok(p.recordCount > 0 && p._new_waitRecordCount > 0, p.date);
    }
    // D20: one 60-minute queue and one 120-minute test, on both clocks.
    const d20 = body[0];
    assert.equal(d20.avgWaitingMinutes, 60);
    assert.equal(d20._new_avgWaitingWorkMinutes, 60);
    assert.equal(d20.avgProcessingMinutes, 120);
    assert.equal(d20._new_avgProcessingWorkMinutes, 120);
    assert.equal(d20._new_avgOffhoursMinutes, 0);
  });

  it("the 13-month cap and the future clamp reach the wire as headers, not as silence", async () => {
    const far = await call("tests/kpis", defaultQuery({ startDate: "2020-01-01", endDate: "2099-01-01" }));
    assert.equal(far.status, 200);
    assert.equal(far.headers.get("x-metrics-period-capped"), "true");
    assert.equal(far.headers.get("x-metrics-period-clamped-end"), "true");
    assert.equal(far.headers.get("x-metrics-period-from"), addDays(addMonths(T(), -UI_MONTH_CAP), 1));
    assert.equal(far.headers.get("x-metrics-period-to"), T());

    // §5.0(1): a filter a query cannot express is NAMED, never dropped.
    const filtered = await call("tests/by-station", defaultQuery({ customerId: String(CUSTOMER) }));
    assert.match(filtered.headers.get("x-metrics-ignored-filters") ?? "", /liveBoard:customerId/);
  });

  it("a missing date range is still a 400, and a bad one still says so", async () => {
    const res = await routes["tests/kpis"](new Request("http://localhost/api/dashboard/tests/kpis") as never);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "startDate and endDate are required");

    const bad = await call("tests/kpis", "startDate=not-a-date&endDate=also-not");
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "Invalid date format");
  });
});
