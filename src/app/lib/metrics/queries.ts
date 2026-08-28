// Q1..Q8 — the ledger read path (§5.2..§5.9 of docs/dashboard-migration-plan-v2.md).
//
// Every number the dashboard shows comes from here. There is no source.ts and
// no routing rule: item_state_interval + route_run are the only sources, and
// there is no cache and no rollup table (§6 — both were deliberately cut, the
// 13-month UI cap is what bounds the work instead).
//
// THE FOUR RULES THAT ARE ENFORCED, NOT JUST DOCUMENTED
// ----------------------------------------------------
//  §5.0(9)  every `@>` / `&&` probe carries `NOT <alias>.is_terminal`, so the
//           partial GiST index isi_range_live is predicate-aligned and actually
//           used. Measured cost of forgetting it: >120s instead of ~400ms.
//           `guardRangeProbes()` is a lint on the generated text, not on the
//           source, and it checks the probe's OWN clause — not the statement,
//           which is what let four of Q3's five guards be deleted unnoticed.
//           `guardAllBuilders()` at the bottom runs it over all 32 statements
//           of the catalogue at module load, so a dropped predicate throws when
//           the module is first imported — build/startup — not on the one
//           request that happens to hit it.
//  §5.0(10) two clocks, always as a pair. Every duration column exists as
//           `_wall_` AND `_work_`. A response that exposes only one is a defect.
//  §5.0(8)  accessory work durations are excluded from duration statistics
//           (their `testing` interval is a synthetic ~0-length pair, §4.7).
//           Counts include accessories; waiting durations include accessories.
//  §5.3ב    "finished" is route_run.closed_at. Never a sample of terminal
//           intervals — `done` is an interval that stays open forever.
//
// The filter text is never written here; it comes from ./filters.ts (§5.1).

import {
  FILTER_PARAM_COUNT,
  RUN_FILTER_PARAM_COUNT,
  intervalFilterParams,
  intervalFilterSql,
  runFilterIgnored,
  runFilterParams,
  runFilterSql,
  type MetricFilters,
  type MetricsScope,
} from "./filters";
import type { BusinessDay, Granularity } from "./period";
import { truncUnit } from "./period";

// ---------------------------------------------------------------------------
// Client + coercion
// ---------------------------------------------------------------------------

/** Structural type satisfied by PrismaClient, a transaction client, or any thin
 *  pg wrapper — the queries never touch generated CRUD (the range columns are
 *  Unsupported("tstzrange")), so this is all they need. */
export interface MetricsClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

type Raw = Record<string, unknown>;

/** numeric/decimal/bigint/string -> number | null, with no silent 0-for-NULL. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Counts: NULL means "no rows", which for a count is 0. */
function cnt(v: unknown): number {
  return num(v) ?? 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

// ---------------------------------------------------------------------------
// §5.0(9) guard
// ---------------------------------------------------------------------------

const PROBE_RE = /(\w+)\.valid_range\s*(?:@>|&&)/g;

/** Keywords that OPEN a boolean clause, and the ones that END it. Only ever
 *  matched at the probe's own paren depth. */
const CLAUSE_OPEN_RE = /\b(?:WHERE|ON|HAVING)\b/gi;
const CLAUSE_END_RE =
  /\b(?:GROUP\s+BY|ORDER\s+BY|WINDOW|LIMIT|OFFSET|FETCH|RETURNING|UNION|INTERSECT|EXCEPT|FROM|JOIN)\b/gi;

/**
 * Blank out string literals and SQL comments, preserving every index.
 *
 * Not paranoia: Q5's statement carries paragraphs of `--` prose that contain
 * the words FROM and WHERE and the parentheses of `work_seconds_between(lo,hi)`.
 * Scanning the raw text would let a comment open a clause, close one, or shift
 * the paren depth of every probe after it. Masking also means a guard that
 * exists only in a comment does not count as a guard.
 */
function maskLiterals(sql: string): string {
  const out = sql.split("");
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      out[i++] = " ";
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out[i] = " "; // '' — an escaped quote, not the end of the literal
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        const closing = sql[i] === "'";
        out[i++] = " ";
        if (closing) break;
      }
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) out[i++] = " ";
      out[i] = " ";
      if (i + 1 < sql.length) out[i + 1] = " ";
      i += 2;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Paren depth of every character. `(` and `)` carry the OUTER depth. */
function parenDepths(masked: string): Int32Array {
  const d = new Int32Array(masked.length);
  let cur = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "(") d[i] = cur++;
    else if (masked[i] === ")") d[i] = --cur;
    else d[i] = cur;
  }
  return d;
}

/** Last match of `re` at depth `depth` inside [lo, hi). */
function lastAtDepth(masked: string, d: Int32Array, re: RegExp, lo: number, hi: number, depth: number): number {
  re.lastIndex = lo;
  let found = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null && m.index < hi) {
    if (d[m.index] === depth) found = m.index;
  }
  return found;
}

/** First match of `re` at depth `depth` inside [lo, hi). */
function firstAtDepth(masked: string, d: Int32Array, re: RegExp, lo: number, hi: number, depth: number): number {
  re.lastIndex = lo;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null && m.index < hi) {
    if (d[m.index] === depth) return m.index;
  }
  return -1;
}

/**
 * Fail loudly if any range probe in a generated query lacks its
 * `NOT <alias>.is_terminal` companion. This is the single predicate that
 * separates "~400ms" from ">120s" (§6.1) and it is too easy to drop while
 * editing SQL, so it is checked mechanically on every built statement.
 *
 * THE GUARD IS LOOKED FOR IN THE PROBE'S OWN CLAUSE, NOT IN THE STATEMENT.
 * The first version searched the whole SQL text for `NOT <alias>.is_terminal`,
 * which made it nearly worthless on exactly the query that needs it most: Q3
 * carries FIVE probes all aliased `q`, so one surviving guard anywhere in the
 * statement satisfied all five and four could be deleted silently (verified —
 * see the unit-test hook below). Each probe is now scoped to the boolean clause
 * it sits in: the innermost enclosing parenthesis group, narrowed to the span
 * between the nearest clause keyword before it and the nearest clause-ending
 * keyword after it, both taken at the probe's own paren depth.
 */
export function guardRangeProbes(sql: string, label: string): string {
  const masked = maskLiterals(sql);
  const d = parenDepths(masked);
  const missing = new Set<string>();

  PROBE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROBE_RE.exec(masked)) !== null) {
    const alias = m[1];
    const p = m.index;
    const depth = d[p];

    // The innermost enclosing parenthesis group.
    let groupStart = 0;
    for (let j = p; j >= 0; j--) {
      if (masked[j] === "(" && d[j] === depth - 1) {
        groupStart = j + 1;
        break;
      }
    }
    let groupEnd = masked.length;
    for (let j = p; j < masked.length; j++) {
      if (masked[j] === ")" && d[j] === depth - 1) {
        groupEnd = j;
        break;
      }
    }

    const opened = lastAtDepth(masked, d, CLAUSE_OPEN_RE, groupStart, p, depth);
    const ended = firstAtDepth(masked, d, CLAUSE_END_RE, p, groupEnd, depth);
    const clause = masked.slice(opened >= 0 ? opened : groupStart, ended >= 0 ? ended : groupEnd);

    if (!new RegExp(`NOT\\s+${alias}\\.is_terminal\\b`).test(clause)) missing.add(alias);
  }

  if (missing.size > 0) {
    throw new Error(
      `${label}: range probe on ${[...missing].map((a) => `${a}.valid_range`).join(", ")} ` +
        `without NOT <alias>.is_terminal in the same clause — §5.0(9); the partial GiST index would be skipped`
    );
  }
  return sql;
}

async function run<T extends Raw>(
  client: MetricsClient,
  label: string,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  return (await client.$queryRawUnsafe<T[]>(guardRangeProbes(sql, label), ...params)) ?? [];
}

/** Every query returns its SQL and params too, so the parity harness and
 *  EXPLAIN runs use the exact text that served the request. */
export interface Built {
  sql: string;
  params: unknown[];
}

// ===========================================================================
// Q1 — §5.2 point-in-time state distribution, ACTIVE population
// ===========================================================================

export interface PointInTimeRow {
  state_key: string;
  label_he: string;
  items: number;
  units: number;
  pct: number | null;
}

/**
 * Q1 is ALWAYS the active population. The v1 variant that counted `done`
 * through `@>` is gone: `done` is an interval open forever, so after 18 months
 * the chart is a grey 99.6% circle and the query scans all history unindexed.
 * The cumulative finished count is a differently-named metric from route_run
 * closures — see {@link finishedCumulative} (§5.3ב).
 */
export function buildPointInTime(at: Date | string, filters: MetricFilters = {}): Built {
  const sql = `
SELECT ms.state_key, ms.label_he,
       count(*)                  AS items,
       count(DISTINCT i.unit_id) AS units,
       round(100.0 * count(*) / NULLIF(sum(count(*)) OVER (), 0), 1) AS pct
FROM   item_state_interval i
JOIN   metric_state ms ON ms.state_key = i.state_key
WHERE  i.valid_range @> $1::timestamptz
  AND  NOT i.is_terminal
  AND  i.is_trusted${intervalFilterSql("i", 2)}
GROUP BY ms.state_key, ms.label_he, ms.sort_order
ORDER BY ms.sort_order`;
  return { sql, params: [at instanceof Date ? at.toISOString() : at, ...intervalFilterParams(filters)] };
}

export async function pointInTime(
  client: MetricsClient,
  at: Date | string,
  filters: MetricFilters = {}
): Promise<PointInTimeRow[]> {
  const b = buildPointInTime(at, filters);
  const rows = await run<Raw>(client, "Q1 pointInTime", b.sql, b.params);
  return rows.map((r) => ({
    state_key: String(r.state_key),
    label_he: String(r.label_he),
    items: cnt(r.items),
    units: cnt(r.units),
    pct: num(r.pct),
  }));
}

// ===========================================================================
// Q2א — §5.3 the point-in-time series
// ===========================================================================

export interface PitSeriesRow {
  business_day: BusinessDay;
  state_key: string;
  label_he: string;
  items: number;
}

/**
 * The grid is built from CIVIL DATES, sampled at 12:00 Israel time.
 *
 * `generate_series($1::date, $2::date, interval '1 day')` — never
 * `timestamptz + interval '1 day'`, which leaks an hour across every DST
 * boundary (verified: 5 points instead of 6 for 2026-03-25..30). `d::date::text`
 * before the concatenation is load-bearing too: `d` is a timestamptz (the
 * preferred generate_series overload), so `d::text` would be
 * '2026-03-25 00:00:00+00' and the whole expression would raise 22007.
 *
 * The §5.1 filter block lives inside the LEFT JOIN's ON, not in the WHERE, so
 * days with no matching rows survive as zeros instead of vanishing (§5.1).
 * There is no gap-filling and no carry-forward (§5.0(7)).
 */
export function buildPitSeries(from: BusinessDay, to: BusinessDay, filters: MetricFilters = {}): Built {
  // The state-set filter is bind #10 of the block; reuse it to trim the
  // cross-joined state list too, otherwise an excluded state would still emit
  // a zero row on every grid day.
  const statesOrdinal = 2 + FILTER_PARAM_COUNT; // $1,$2 are the dates
  // THE LATERAL IS THE PLAN, NOT A STYLE CHOICE.
  //
  // Written as a plain LEFT JOIN (the §5.3 text), the planner is free to
  // reorder, and with `scope = open_shipments` it does: the open-shipments
  // EXISTS becomes a hashed SubPlan attached to the interval scan, which forces
  // every non-terminal interval to be materialised first and turns
  // `valid_range @> g.at_ts` from an index condition into a JOIN FILTER.
  // Measured on this database (6,426 intervals, 396 grid days):
  //
  //     LEFT JOIN, scope=open_shipments   1,730 ms   Hash Right Join,
  //                                                  "Rows Removed by Join
  //                                                  Filter: 2,300,540"
  //     LEFT JOIN, scope=all                 79 ms   Index Scan on isi_range_live
  //     LATERAL,   scope=open_shipments      42 ms   Index Scan, 396 probes
  //     LATERAL,   scope=all                 79 ms   Index Scan, 396 probes
  //
  // That is §5.0(9)'s failure mode arriving through the planner instead of
  // through a missing predicate — the cost of the bad plan is
  // (non-terminal rows x grid days), so at year-3 volume it is ~1.2e9 filter
  // evaluations rather than 2.3e6. The LATERAL cannot be flattened (it carries
  // an aggregate), so the index scan is structural: one probe per grid DAY,
  // never one per day x state. `metric_state` is still CROSS JOINed on the
  // outside, so a day on which a state has nothing survives as a zero and no
  // value is carried forward (§5.1, §5.0(7)).
  const sql = `
WITH grid AS (
  SELECT (d::date::text || ' 12:00')::timestamp AT TIME ZONE 'Asia/Jerusalem' AS at_ts,
         to_char(d::date, 'YYYY-MM-DD') AS business_day
  FROM generate_series($1::date, $2::date, interval '1 day') d
)
SELECT g.business_day, s.state_key, s.label_he, COALESCE(x.items, 0) AS items
FROM grid g
CROSS JOIN (SELECT * FROM metric_state
             WHERE NOT is_terminal
               AND ($${statesOrdinal}::text[] IS NULL OR state_key = ANY($${statesOrdinal}::text[]))) s
LEFT JOIN LATERAL (
  SELECT i.state_key, count(*) AS items
  FROM item_state_interval i
  WHERE NOT i.is_terminal
    AND i.valid_range @> g.at_ts
    AND i.is_trusted${intervalFilterSql("i", 3)}
  GROUP BY i.state_key
) x ON x.state_key = s.state_key
ORDER BY g.business_day, s.sort_order`;
  return { sql, params: [from, to, ...intervalFilterParams(filters)] };
}

export async function pitSeries(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {}
): Promise<PitSeriesRow[]> {
  const b = buildPitSeries(from, to, filters);
  const rows = await run<Raw>(client, "Q2a pitSeries", b.sql, b.params);
  return rows.map((r) => ({
    business_day: String(r.business_day),
    state_key: String(r.state_key),
    label_he: String(r.label_he),
    items: cnt(r.items),
  }));
}

// ===========================================================================
// Q2ב — §5.3ב finished_cumulative, from route_run closures
// ===========================================================================

export interface FinishedCumulativeRow {
  business_day: BusinessDay;
  finished_today: number;
  finished_cumulative: number;
}

export interface FinishedCumulativeResult {
  rows: FinishedCumulativeRow[];
  /** Filters route_run cannot express (station / station type / worker / state).
   *  Surfaced rather than silently dropped — see filters.ts. */
  ignoredFilters: string[];
}

/**
 * THE ONE DEFINITION OF "FINISHED". The anchor is route_run.closed_at (partial
 * index route_run_closed). Genuinely entry-anchored: a closure is counted once,
 * on the day it happened, additively, independent of any sampling instant —
 * unlike the v1 `@>` form which both sampled only up to noon and rescanned all
 * of history at every grid point.
 */
export function buildFinishedCumulative(
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {}
): Built {
  const sql = `
WITH grid AS (
  SELECT d::date AS business_day
  FROM generate_series($1::date, $2::date, interval '1 day') d
), closures AS (
  SELECT business_date(rr.closed_at) AS bd, count(*) AS n
  FROM route_run rr
  WHERE rr.closed_at IS NOT NULL AND rr.is_trusted${runFilterSql("rr", 3)}
  GROUP BY 1
), base AS (
  SELECT COALESCE(sum(n), 0) AS n0 FROM closures WHERE bd < $1::date
)
SELECT to_char(g.business_day, 'YYYY-MM-DD') AS business_day,
       COALESCE(c.n, 0) AS finished_today,
       (SELECT n0 FROM base)
       + COALESCE(sum(c.n) OVER (ORDER BY g.business_day), 0) AS finished_cumulative
FROM grid g
LEFT JOIN closures c ON c.bd = g.business_day
ORDER BY g.business_day`;
  return { sql, params: [from, to, ...runFilterParams(filters)] };
}

export async function finishedCumulative(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {}
): Promise<FinishedCumulativeResult> {
  const b = buildFinishedCumulative(from, to, filters);
  const rows = await run<Raw>(client, "Q2b finishedCumulative", b.sql, b.params);
  return {
    rows: rows.map((r) => ({
      business_day: String(r.business_day),
      finished_today: cnt(r.finished_today),
      finished_cumulative: cnt(r.finished_cumulative),
    })),
    ignoredFilters: runFilterIgnored(filters),
  };
}

/** §5.10 `kpi_treated_count` / `live_items_finished` in-window — the same anchor
 *  as Q2ב, counted over a window instead of accumulated. */
export async function finishedInWindow(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {}
): Promise<{ finished_runs: number; ignoredFilters: string[] }> {
  const sql = `
SELECT count(*) AS finished_runs
FROM route_run rr
WHERE rr.closed_at IS NOT NULL AND rr.is_trusted
  AND business_date(rr.closed_at) BETWEEN $1::date AND $2::date${runFilterSql("rr", 3)}`;
  const rows = await run<Raw>(client, "Q2b finishedInWindow", sql, [from, to, ...runFilterParams(filters)]);
  return { finished_runs: cnt(rows[0]?.finished_runs), ignoredFilters: runFilterIgnored(filters) };
}

// ===========================================================================
// Q3 — §5.4 the live station board
// ===========================================================================

export interface StationBoardRow {
  test_station_id: number;
  station_name: string | null;
  station_type_id: number | null;
  station_type_name: string | null;
  in_test: number;
  in_research: number;
  /** The queue belongs to the TYPE, not the station. Reported honestly. */
  shared_type_queue: number;
  standing_queue_age_wall_min: number | null;
  standing_queue_age_work_min: number | null;
  research_pool_queue: number;
  active_test_age_wall_min: number | null;
  active_test_age_work_min: number | null;
}

/**
 * The probe is `@> now() AND NOT is_terminal`, deliberately NOT `upper_inf`:
 * terminal (`done`) intervals stay open forever, so "everything open" is
 * O(every item ever finished) — ~330k in year 3, not hundreds. The probe form
 * is semantically identical for every non-terminal state and is served by
 * isi_range_live.
 *
 * `standing_queue_age_*` is measured over the items WAITING FOR THIS STATION
 * TYPE, not over the running tests — the original spec's bug, where a station
 * with 22 items waiting 47 minutes and two 6-9 minute tests reported 7.5.
 * `active_test_age_*` is the new metric, in both clocks per §5.0(10).
 */
export function buildStationBoard(): Built {
  const sql = `
WITH type_queue AS (
  -- THE TYPE'S QUEUE IS SCANNED ONCE, NOT ONCE PER COLUMN. The three numbers
  -- below were three correlated subqueries with an identical WHERE, differing
  -- only in their aggregate; PostgreSQL plans that as three independent
  -- SubPlans and the estimated cost of the statement crossed jit_above_cost
  -- (100,000) at 358,562 — measured, 54-139ms of LLVM on a query whose real
  -- work is ten rows and 71ms. Same defect and same fix as Q7's declared CTE.
  SELECT q.station_type_id,
         count(*)                                                   AS n,
         avg(EXTRACT(EPOCH FROM (now() - lower(q.valid_range))))/60 AS age_wall_min,
         avg(work_seconds_between(lower(q.valid_range), now()))/60   AS age_work_min
  FROM item_state_interval q
  WHERE q.valid_range @> now() AND NOT q.is_terminal AND q.state_key = 'queued'
  GROUP BY q.station_type_id
), research_pool AS (
  -- Uncorrelated, so it is one row for the whole board (§5.4: one count, no
  -- double-count between research stations).
  SELECT count(*) AS n FROM item_state_interval q
  WHERE q.valid_range @> now() AND NOT q.is_terminal
    AND q.state_key = 'queued_research'
)
SELECT st.test_station_id,
       TRIM(st.test_station_desc) AS station_name,
       st.test_station_type_id    AS station_type_id,
       TRIM(sty.test_type_desc)   AS station_type_name,
       count(*) FILTER (WHERE i.state_key = 'testing')     AS in_test,
       count(*) FILTER (WHERE i.state_key = 'in_research') AS in_research,
       -- COALESCE keeps the LEFT JOIN's NULL identical to the old subquery's
       -- count(*) = 0; the two ages stay NULL, because avg() over no rows is
       -- "nobody is waiting", not "the wait is zero".
       COALESCE(tq.n, 0)                                            AS shared_type_queue,
       tq.age_wall_min                                              AS standing_queue_age_wall_min,
       tq.age_work_min                                              AS standing_queue_age_work_min,
       rp.n                                                         AS research_pool_queue,
       avg(EXTRACT(EPOCH FROM (now() - lower(i.valid_range))))
         FILTER (WHERE NOT i.is_accessory)/60                        AS active_test_age_wall_min,
       avg(work_seconds_between(lower(i.valid_range), now()))
         FILTER (WHERE NOT i.is_accessory)/60                        AS active_test_age_work_min
FROM test_stations st
JOIN test_stations_type sty ON sty.test_station_type_id = st.test_station_type_id
LEFT JOIN type_queue tq ON tq.station_type_id = st.test_station_type_id
CROSS JOIN research_pool rp
LEFT JOIN item_state_interval i
       ON i.station_id = st.test_station_id
      AND i.valid_range @> now() AND NOT i.is_terminal
GROUP BY st.test_station_id, st.test_station_desc, sty.test_type_desc, st.test_station_type_id,
         tq.n, tq.age_wall_min, tq.age_work_min, rp.n
ORDER BY st.test_station_id`;
  return { sql, params: [] };
}

export async function stationBoard(client: MetricsClient): Promise<StationBoardRow[]> {
  const b = buildStationBoard();
  const rows = await run<Raw>(client, "Q3 stationBoard", b.sql, b.params);
  return rows.map((r) => ({
    test_station_id: cnt(r.test_station_id),
    station_name: str(r.station_name),
    station_type_id: num(r.station_type_id),
    station_type_name: str(r.station_type_name),
    in_test: cnt(r.in_test),
    in_research: cnt(r.in_research),
    shared_type_queue: cnt(r.shared_type_queue),
    standing_queue_age_wall_min: num(r.standing_queue_age_wall_min),
    standing_queue_age_work_min: num(r.standing_queue_age_work_min),
    research_pool_queue: cnt(r.research_pool_queue),
    active_test_age_wall_min: num(r.active_test_age_wall_min),
    active_test_age_work_min: num(r.active_test_age_work_min),
  }));
}

// ===========================================================================
// Q4 — §5.5 flow and duration, grouped by any dimension
// ===========================================================================

export type FlowDimension =
  | "none"
  | "station"
  | "station_type"
  | "customer"
  | "shipment"
  | "item_type"
  | "worker"
  | "item_type_step";

/** `is_active_work` for test/research time; `is_waiting` for queue time. */
export type FlowFamily = "active_work" | "waiting";

interface DimensionSpec {
  select: string[];
  group: string[];
  join: string;
}

const DIMENSIONS: Record<FlowDimension, DimensionSpec> = {
  none: { select: [], group: [], join: "" },
  station: {
    // station_type_id travels with the station row so a caller that ranks
    // stations can then ask a station-TYPE question about the winner without a
    // second lookup — kpi_busiest_station_wait_seconds is exactly that (§5.10:
    // the wait belongs to the TYPE, §5.4). Safe to add to the GROUP BY: a
    // station has one type, verified on this database (0 stations whose
    // intervals carry more than one station_type_id).
    select: [
      "i.station_id",
      "TRIM(st.test_station_desc) AS station_name",
      "i.station_type_id",
    ],
    group: ["i.station_id", "st.test_station_desc", "i.station_type_id"],
    join: "LEFT JOIN test_stations st ON st.test_station_id = i.station_id",
  },
  station_type: {
    select: ["i.station_type_id", "TRIM(sty.test_type_desc) AS station_type_name"],
    group: ["i.station_type_id", "sty.test_type_desc"],
    join: "LEFT JOIN test_stations_type sty ON sty.test_station_type_id = i.station_type_id",
  },
  customer: {
    select: ["i.customer_id", "TRIM(cu.name) AS customer_name"],
    group: ["i.customer_id", "cu.name"],
    join: "LEFT JOIN customers cu ON cu.id = i.customer_id",
  },
  shipment: {
    select: ["i.shipment_id", "TRIM(sh.shipment_code) AS shipment_code"],
    group: ["i.shipment_id", "sh.shipment_code"],
    join: "LEFT JOIN shipments sh ON sh.id = i.shipment_id",
  },
  item_type: {
    select: ["i.item_type_id", "TRIM(ity.item_type_desc) AS item_type_name"],
    group: ["i.item_type_id", "ity.item_type_desc"],
    join: "LEFT JOIN item_types ity ON ity.item_type_id = i.item_type_id",
  },
  worker: {
    // worker_name is not functionally dependent on the id (it is a snapshot of
    // the name at exit time), so it is aggregated rather than grouped.
    select: ["i.exited_by_worker_id AS worker_id", "max(i.exited_by_worker_name) AS worker_name"],
    group: ["i.exited_by_worker_id"],
    join: "",
  },
  item_type_step: {
    select: ["i.item_type_id", "TRIM(ity.item_type_desc) AS item_type_name", "i.step_no"],
    group: ["i.item_type_id", "ity.item_type_desc", "i.step_no"],
    join: "LEFT JOIN item_types ity ON ity.item_type_id = i.item_type_id",
  },
};

/** The dimensions under which `unit_id` is a legal de-duplication key (§5.0(6)):
 *  the grouping key is constant inside a unit. `none` is the ungrouped total. */
const UNIT_DEDUP_DIMENSIONS: ReadonlySet<FlowDimension> = new Set<FlowDimension>([
  "none",
  "customer",
  "shipment",
]);

export interface FlowOptions {
  dimension?: FlowDimension;
  family?: FlowFamily;
  /** Bucket by close_business_date (default true). False = one row per dimension. */
  byDay?: boolean;
  /** Roll days up into months/quarters. Ignored when byDay is false. */
  granularity?: Granularity;
}

export interface FlowRow {
  d: BusinessDay | null;
  station_id?: number | null;
  station_name?: string | null;
  station_type_id?: number | null;
  station_type_name?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  shipment_id?: number | null;
  shipment_code?: string | null;
  item_type_id?: number | null;
  item_type_name?: string | null;
  worker_id?: number | null;
  worker_name?: string | null;
  step_no?: number | null;
  steps_processed: number;
  steps_completed: number;
  diverted_to_research: number;
  returned_from_research: number;
  abandonments: number;
  /** PRESENT ONLY for dimension ∈ {none, customer, shipment} — §5.0(6). Absent
   *  for station, station_type, item_type, item_type_step and worker, where
   *  unit_id is not a legal de-duplication key. */
  units_processed?: number;
  operations: number;
  rework_steps: number;
  restarts_after_abandonment: number;
  manual_entries: number;
  n: number;
  avg_wall_min: number | null;
  avg_work_min: number | null;
  avg_offhours_min: number | null;
  wall_hours: number | null;
  work_hours: number | null;
  p95_wall_min: number | null;
  p95_work_min: number | null;
  max_wall_min: number | null;
  max_work_min: number | null;
}

/**
 * The grouping anchor is close_business_date: an interval opened Thursday and
 * closed Sunday is Sunday's thorn.
 *
 * "processed" is NOT `result_submitted` alone — an `in_research` interval almost
 * always closes as `returned_to_route`, and a research station with 30
 * treatments a week (27 of them returns) used to report 3.
 *
 * rework comes from `entry_reason`, never from `attempt_no`: the reaper returns
 * every test older than its type's threshold to the queue, and attempt_no would
 * report 100% rework at any station whose tests run longer than that.
 *
 * §5.0(8): accessory durations are excluded from the duration statistics of the
 * active-work family (their interval is a synthetic ~0-length pair). Waiting
 * durations keep accessories — an accessory really does wait.
 */
export function buildFlow(
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {},
  opts: FlowOptions = {}
): Built {
  const dim = DIMENSIONS[opts.dimension ?? "station"];
  const family = opts.family ?? "active_work";
  const byDay = opts.byDay !== false;
  const flag = family === "waiting" ? "ms.is_waiting" : "ms.is_active_work";
  // The accessory exclusion applies to durations only, and only to active work.
  const F = family === "active_work" ? " FILTER (WHERE NOT i.is_accessory)" : "";
  const unit = truncUnit(opts.granularity ?? "daily");
  const dayExpr =
    unit === "day"
      ? "to_char(i.close_business_date, 'YYYY-MM-DD')"
      : `to_char(date_trunc('${unit}', i.close_business_date)::date, 'YYYY-MM-DD')`;

  const selects = [...(byDay ? [`${dayExpr} AS d`] : []), ...dim.select];
  const groups = [...(byDay ? [dayExpr] : []), ...dim.group];

  // §5.0(6): unit_id de-duplicates only where the grouping key is CONSTANT
  // within a unit. It is for customer and shipment (and for the ungrouped
  // total); it is not for item_type, station or step — an accessory shares its
  // parent's unit_id but carries its own type and its steps land at other
  // stations, so `count(DISTINCT unit_id)` under those keys counts one unit
  // once per group and the column is neither a unit count nor additive down
  // the table. The column is therefore not emitted at all rather than emitted
  // and annotated: a number on a screen is read, not read about.
  const unitsProcessed = UNIT_DEDUP_DIMENSIONS.has(opts.dimension ?? "station")
    ? `\n       count(DISTINCT i.unit_id) FILTER (WHERE i.exit_reason NOT IN ('released_by_user','released_stale')) AS units_processed,`
    : "";

  const sql = `
SELECT ${selects.length ? selects.join(",\n       ") + "," : ""}
       count(*) FILTER (WHERE i.exit_reason NOT IN ('released_by_user','released_stale')) AS steps_processed,
       count(*) FILTER (WHERE i.exit_reason = 'result_submitted')            AS steps_completed,
       count(*) FILTER (WHERE i.exit_reason = 'sent_to_research')            AS diverted_to_research,
       count(*) FILTER (WHERE i.exit_reason = 'returned_to_route')           AS returned_from_research,
       count(*) FILTER (WHERE i.exit_reason IN ('released_by_user','released_stale')) AS abandonments,${unitsProcessed}
       count(DISTINCT ev.submit_id)                                          AS operations,
       count(*) FILTER (WHERE i.entry_reason = 'returned_to_route')          AS rework_steps,
       count(*) FILTER (WHERE i.entry_reason IN ('released_by_user','released_stale')) AS restarts_after_abandonment,
       count(*) FILTER (WHERE i.entry_reason = 'manual_override')            AS manual_entries,
       count(*)${F}                                                          AS n,
       avg(i.wall_seconds)${F}/60                                            AS avg_wall_min,
       avg(i.work_seconds)${F}/60                                            AS avg_work_min,
       avg(i.offhours_seconds)${F}/60                                        AS avg_offhours_min,
       sum(i.wall_seconds)${F}/3600                                          AS wall_hours,
       sum(i.work_seconds)${F}/3600                                          AS work_hours,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY i.wall_seconds)${F}/60    AS p95_wall_min,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY i.work_seconds)${F}/60    AS p95_work_min,
       max(i.wall_seconds)${F}/60                                            AS max_wall_min,
       max(i.work_seconds)${F}/60                                            AS max_work_min
FROM   item_state_interval i
JOIN   metric_state ms ON ms.state_key = i.state_key AND ${flag}
${dim.join}
LEFT   JOIN item_state_event ev ON ev.event_id = i.exit_event_id
WHERE  i.close_business_date BETWEEN $1::date AND $2::date
  AND  i.closed_at IS NOT NULL AND i.is_trusted AND NOT i.is_terminal${intervalFilterSql("i", 3)}
${groups.length ? `GROUP BY ${groups.join(", ")}\nORDER BY ${groups.join(", ")}` : ""}`;

  return { sql, params: [from, to, ...intervalFilterParams(filters)] };
}

export async function flow(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {},
  opts: FlowOptions = {}
): Promise<FlowRow[]> {
  const b = buildFlow(from, to, filters, opts);
  const rows = await run<Raw>(client, "Q4 flow", b.sql, b.params);
  return rows.map((r) => ({
    d: r.d === undefined || r.d === null ? null : String(r.d),
    ...(r.station_id !== undefined ? { station_id: num(r.station_id), station_name: str(r.station_name) } : {}),
    ...(r.station_type_id !== undefined
      ? { station_type_id: num(r.station_type_id), station_type_name: str(r.station_type_name) }
      : {}),
    ...(r.customer_id !== undefined ? { customer_id: num(r.customer_id), customer_name: str(r.customer_name) } : {}),
    ...(r.shipment_id !== undefined ? { shipment_id: num(r.shipment_id), shipment_code: str(r.shipment_code) } : {}),
    ...(r.item_type_id !== undefined
      ? { item_type_id: num(r.item_type_id), item_type_name: str(r.item_type_name) }
      : {}),
    ...(r.worker_id !== undefined ? { worker_id: num(r.worker_id), worker_name: str(r.worker_name) } : {}),
    ...(r.step_no !== undefined ? { step_no: num(r.step_no) } : {}),
    steps_processed: cnt(r.steps_processed),
    steps_completed: cnt(r.steps_completed),
    diverted_to_research: cnt(r.diverted_to_research),
    returned_from_research: cnt(r.returned_from_research),
    abandonments: cnt(r.abandonments),
    ...(r.units_processed !== undefined ? { units_processed: cnt(r.units_processed) } : {}),
    operations: cnt(r.operations),
    rework_steps: cnt(r.rework_steps),
    restarts_after_abandonment: cnt(r.restarts_after_abandonment),
    manual_entries: cnt(r.manual_entries),
    n: cnt(r.n),
    avg_wall_min: num(r.avg_wall_min),
    avg_work_min: num(r.avg_work_min),
    avg_offhours_min: num(r.avg_offhours_min),
    wall_hours: num(r.wall_hours),
    work_hours: num(r.work_hours),
    p95_wall_min: num(r.p95_wall_min),
    p95_work_min: num(r.p95_work_min),
    max_wall_min: num(r.max_wall_min),
    max_work_min: num(r.max_work_min),
  }));
}

// ===========================================================================
// Q5 — §5.6 window-clipped KPIs, items in flight included
// ===========================================================================

export type KpiDimension = "none" | "station" | "station_type" | "customer" | "shipment" | "item_type" | "worker";

const KPI_DIM_COLUMN: Record<KpiDimension, string | null> = {
  none: null,
  station: "station_id",
  station_type: "station_type_id",
  customer: "customer_id",
  shipment: "shipment_id",
  item_type: "item_type_id",
  worker: "exited_by_worker_id",
};

export interface KpiWindowRow {
  dimension_id?: number | null;
  avg_wait_wall_min: number | null;
  avg_wait_work_min: number | null;
  wait_n: number;
  avg_busy_wall_min: number | null;
  avg_busy_work_min: number | null;
  busy_n: number;
  avg_research_wait_wall_min: number | null;
  avg_research_wait_work_min: number | null;
  avg_research_wall_min: number | null;
  avg_research_work_min: number | null;
  offhours_min: number | null;
  units_touched: number;
  /** sum of clipped active-work work_seconds — numerator of station_utilisation_pct. */
  busy_work_seconds: number | null;
  /** work_seconds_between(window start, window end) — its denominator. */
  window_work_seconds: number | null;
}

/**
 * Replaces getKpiStatsFiltered, which joins item_route_history on the item's
 * CURRENT station only — a bias that grows with route length. Here every step
 * inside the window counts, including intervals still open at the far edge
 * (clipped at now()).
 *
 * FILTER goes immediately after the aggregate and the /60 after that:
 * `avg(...)/60 FILTER (...)` is a syntax error (42601), verified on PG16.
 */
export function buildKpiWindow(
  fromTs: Date | string,
  toTsExclusive: Date | string,
  filters: MetricFilters = {},
  dimension: KpiDimension = "none"
): Built {
  const col = KPI_DIM_COLUMN[dimension];
  const sql = `
WITH win AS (SELECT tstzrange($1::timestamptz, $2::timestamptz, '[)') AS w),
clipped AS (
  SELECT i.*, ms.is_waiting, ms.is_active_work, ms.is_research,
         GREATEST(lower(i.valid_range), lower(w.w))                     AS lo,
         LEAST(COALESCE(i.closed_at, now()), upper(w.w))                AS hi
  FROM item_state_interval i
  CROSS JOIN win w
  JOIN metric_state ms ON ms.state_key = i.state_key
  WHERE i.valid_range && w.w AND i.is_trusted AND NOT i.is_terminal${intervalFilterSql("i", 3)}
),
-- The two clocks are materialised ONCE per clipped row. Written inline, as the
-- spec has it, work_seconds_between(lo,hi) appears in six aggregate expressions
-- and PostgreSQL evaluates a STABLE function per expression per row: measured
-- 5,390ms for 13 months here versus 322ms hoisted, on identical output. The
-- ladder lookup is two index probes, so the cost is entirely the call count.
-- MATERIALIZED is load-bearing, not decoration: a CTE referenced once is
-- inlined by default, which substitutes the call straight back into all six
-- aggregates and reproduces the 5,390ms plan exactly.
--
-- The CASE is the other half. work_seconds_between() costs ~0.55ms per call
-- (two ladder probes plus a current_calendar_version() lookup), so calling it
-- once per clipped row is still ~3.2s over 13 months. But an interval that lies
-- ENTIRELY inside the window is not clipped at all — lo is its own lower bound
-- and hi is its own closed_at — and the ledger already stores exactly that
-- number in work_seconds, written at close time. Only the handful of intervals
-- straddling a window edge need the function. Using the stored column is also
-- the more correct answer: it is what Q4/Q6/Q8 report for the same interval, so
-- the work clock now agrees with itself across queries even while a retroactive
-- calendar change (§7.4) is still being recomputed.
spans AS MATERIALIZED (
  SELECT c.*,
         EXTRACT(EPOCH FROM (c.hi - c.lo)) AS wall_s,
         CASE WHEN c.lo = lower(c.valid_range) AND c.hi = c.closed_at THEN c.work_seconds
              ELSE work_seconds_between(c.lo, c.hi)
         END                               AS work_s
  FROM clipped c
)
SELECT${col ? `\n  ${col} AS dimension_id,` : ""}
  avg(wall_s) FILTER (WHERE is_waiting) / 60     AS avg_wait_wall_min,
  avg(work_s) FILTER (WHERE is_waiting) / 60     AS avg_wait_work_min,
  count(*)    FILTER (WHERE is_waiting)          AS wait_n,
  avg(wall_s) FILTER (WHERE is_active_work AND NOT is_accessory) / 60 AS avg_busy_wall_min,
  avg(work_s) FILTER (WHERE is_active_work AND NOT is_accessory) / 60 AS avg_busy_work_min,
  count(*)    FILTER (WHERE is_active_work AND NOT is_accessory)      AS busy_n,
  avg(wall_s) FILTER (WHERE is_research AND is_waiting) / 60          AS avg_research_wait_wall_min,
  avg(work_s) FILTER (WHERE is_research AND is_waiting) / 60          AS avg_research_wait_work_min,
  avg(wall_s) FILTER (WHERE is_research AND is_active_work) / 60      AS avg_research_wall_min,
  avg(work_s) FILTER (WHERE is_research AND is_active_work) / 60      AS avg_research_work_min,
  sum(wall_s - COALESCE(work_s, 0))/60                                AS offhours_min,
  count(DISTINCT unit_id)                                             AS units_touched,
  sum(work_s) FILTER (WHERE is_active_work AND NOT is_accessory)      AS busy_work_seconds,
  (SELECT work_seconds_between($1::timestamptz, $2::timestamptz))     AS window_work_seconds
FROM spans${col ? `\nGROUP BY ${col}\nORDER BY ${col}` : ""}`;
  return {
    sql,
    params: [
      fromTs instanceof Date ? fromTs.toISOString() : fromTs,
      toTsExclusive instanceof Date ? toTsExclusive.toISOString() : toTsExclusive,
      ...intervalFilterParams(filters),
    ],
  };
}

/**
 * NO CONSUMER FOR THE GROUPED FORM. Every caller today goes through
 * {@link kpiWindowOne}, i.e. `dimension = "none"`; nothing passes a dimension.
 * The parameter is kept because §5.10's `kpi_busiest_station_wait_seconds` is a
 * per-station Q5 and stage 6 is where it lands, and because dropping it would
 * mean re-deriving the GROUP BY that {@link buildKpiWindow} already gets right.
 * The catalogue sweep builds every dimension, so the shapes stay honest.
 */
export async function kpiWindow(
  client: MetricsClient,
  fromTs: Date | string,
  toTsExclusive: Date | string,
  filters: MetricFilters = {},
  dimension: KpiDimension = "none"
): Promise<KpiWindowRow[]> {
  const b = buildKpiWindow(fromTs, toTsExclusive, filters, dimension);
  const rows = await run<Raw>(client, "Q5 kpiWindow", b.sql, b.params);
  return rows.map((r) => ({
    ...(r.dimension_id !== undefined ? { dimension_id: num(r.dimension_id) } : {}),
    avg_wait_wall_min: num(r.avg_wait_wall_min),
    avg_wait_work_min: num(r.avg_wait_work_min),
    wait_n: cnt(r.wait_n),
    avg_busy_wall_min: num(r.avg_busy_wall_min),
    avg_busy_work_min: num(r.avg_busy_work_min),
    busy_n: cnt(r.busy_n),
    avg_research_wait_wall_min: num(r.avg_research_wait_wall_min),
    avg_research_wait_work_min: num(r.avg_research_wait_work_min),
    avg_research_wall_min: num(r.avg_research_wall_min),
    avg_research_work_min: num(r.avg_research_work_min),
    offhours_min: num(r.offhours_min),
    units_touched: cnt(r.units_touched),
    busy_work_seconds: num(r.busy_work_seconds),
    window_work_seconds: num(r.window_work_seconds),
  }));
}

/** Convenience: the single-row form Q5 is normally used in. */
export async function kpiWindowOne(
  client: MetricsClient,
  fromTs: Date | string,
  toTsExclusive: Date | string,
  filters: MetricFilters = {}
): Promise<KpiWindowRow> {
  const rows = await kpiWindow(client, fromTs, toTsExclusive, filters, "none");
  return (
    rows[0] ?? {
      avg_wait_wall_min: null,
      avg_wait_work_min: null,
      wait_n: 0,
      avg_busy_wall_min: null,
      avg_busy_work_min: null,
      busy_n: 0,
      avg_research_wait_wall_min: null,
      avg_research_wait_work_min: null,
      avg_research_wall_min: null,
      avg_research_work_min: null,
      offhours_min: null,
      units_touched: 0,
      busy_work_seconds: null,
      window_work_seconds: null,
    }
  );
}

// ===========================================================================
// Q6 — §5.7 the slowest steps
// ===========================================================================

export interface SlowStepRow {
  item_id: number;
  serial_no: string | null;
  makat: string | null;
  model: string | null;
  step_no: number;
  attempt_no: number;
  entry_reason: string;
  station_name: string | null;
  worker_id: number | null;
  worker_name: string | null;
  queue_wall_min: number | null;
  queue_work_min: number | null;
  test_wall_min: number | null;
  test_work_min: number | null;
  total_wall_min: number | null;
  total_work_min: number | null;
}

/**
 * The LATERAL is exact because the EXCLUDE constraint guarantees the previous
 * interval ends exactly where this one starts (isi_item_time serves it). The
 * `cand` CTE narrows to 500 rows BEFORE the LATERAL.
 */
export function buildSlowSteps(
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {},
  limit = 20
): Built {
  const limitOrdinal = 3 + FILTER_PARAM_COUNT;
  const sql = `
WITH cand AS (
  SELECT i.*
  FROM item_state_interval i
  JOIN metric_state ms ON ms.state_key = i.state_key AND ms.is_active_work
  WHERE i.close_business_date BETWEEN $1::date AND $2::date
    AND i.closed_at IS NOT NULL AND i.is_trusted
    AND NOT i.is_accessory${intervalFilterSql("i", 3)}
  ORDER BY i.work_seconds DESC NULLS LAST
  LIMIT 500
)
SELECT c.item_id, c.serial_no, it.makat, TRIM(it.model) AS model,
       c.step_no, c.attempt_no, c.entry_reason,
       TRIM(st.test_station_desc) AS station_name,
       -- worker_id as well as worker_name: §5.10 lists slow_item_worker_id as a
       -- Q6 output and the SlowItemRow component reads it, but §5.7's SELECT
       -- carries only the name. (transcription fix)
       c.exited_by_worker_id AS worker_id, c.exited_by_worker_name AS worker_name,
       q.wall_seconds/60 AS queue_wall_min, q.work_seconds/60 AS queue_work_min,
       c.wall_seconds/60 AS test_wall_min,  c.work_seconds/60 AS test_work_min,
       (COALESCE(q.wall_seconds,0) + c.wall_seconds)/60 AS total_wall_min,
       (COALESCE(q.work_seconds,0) + c.work_seconds)/60 AS total_work_min
FROM cand c
JOIN items it ON it.item_id = c.item_id
LEFT JOIN test_stations st ON st.test_station_id = c.station_id
LEFT JOIN LATERAL (
  SELECT p.wall_seconds, p.work_seconds FROM item_state_interval p
  WHERE p.item_id = c.item_id AND p.closed_at = lower(c.valid_range)
  ORDER BY p.interval_id DESC
  LIMIT 1
) q ON true
ORDER BY total_work_min DESC NULLS LAST
LIMIT LEAST($${limitOrdinal}::int, 100)`;
  return { sql, params: [from, to, ...intervalFilterParams(filters), Math.max(1, Math.trunc(limit))] };
}

export async function slowSteps(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {},
  limit = 20
): Promise<SlowStepRow[]> {
  const b = buildSlowSteps(from, to, filters, limit);
  const rows = await run<Raw>(client, "Q6 slowSteps", b.sql, b.params);
  return rows.map((r) => ({
    item_id: cnt(r.item_id),
    serial_no: str(r.serial_no),
    makat: str(r.makat),
    model: str(r.model),
    step_no: cnt(r.step_no),
    attempt_no: cnt(r.attempt_no),
    entry_reason: String(r.entry_reason),
    station_name: str(r.station_name),
    worker_id: num(r.worker_id),
    worker_name: str(r.worker_name),
    queue_wall_min: num(r.queue_wall_min),
    queue_work_min: num(r.queue_work_min),
    test_wall_min: num(r.test_wall_min),
    test_work_min: num(r.test_work_min),
    total_wall_min: num(r.total_wall_min),
    total_work_min: num(r.total_work_min),
  }));
}

// ===========================================================================
// Q7 — §5.8 entity progress (shipment / customer / item type)
// ===========================================================================

export type ProgressEntity = "shipment" | "customer" | "item_type";

export interface EntityProgressRow {
  entity_id: number;
  entity_code: string | null;
  entity_name: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_code?: string | null;
  shipment_date?: Date | string | null;
  /** shipments.amount for shipments; the item count for customers / item types.
   *  A STOCK number, never the denominator of a test completion ratio. */
  declared_amount: number | null;
  routed_runs: number;
  routed_units: number;
  finished_runs: number;
  in_queue: number;
  in_test: number;
  waiting_research: number;
  in_research: number;
  finished: number;
  completion_pct: number | null;
  coverage_pct: number | null;
  avg_route_turnaround_wall_min: number | null;
  avg_route_turnaround_work_min: number | null;
  ship_turnaround_wall_min?: number | null;
  ship_turnaround_work_min?: number | null;
}

/**
 * Q7 stays on `upper_inf` deliberately (§5.4's note): it NEEDS the `done` rows
 * for the completion count, and `NOT is_terminal` here would zero `finished`.
 * This is the one place where `count(*) FILTER (state_key='done')` is legal:
 * the rows arrive via route_run, not via a global `@>` probe.
 *
 * THE PER-RUN LOOKUP IS THE LATERAL, NOT A HOPE. §5.4 justified keeping
 * `upper_inf` by asserting the join is "a lookup per route_run, not a scan of
 * the open set". Written as a plain LEFT JOIN it was the opposite: measured on
 * this database the plan was a Bitmap Heap Scan over isi_one_open_per_item —
 * every open interval that has ever existed, which INCLUDES every terminal
 * `done` row (~330k in year 3, §5.4) — hash-joined against route_run. The scan
 * is unconditional: with `scope = open_shipments` narrowed to 5% of shipments
 * (the year-3 shape, simulated in a rolled-back transaction) route_run dropped
 * to 18 rows and the interval side still read all 630 open rows / 268 buffers.
 * A plain LATERAL does NOT fix it — the planner flattens a simple lateral
 * subquery straight back into the same hash join (measured: identical plan,
 * same Bitmap Heap Scan, same times). Carrying the aggregates INSIDE the
 * lateral is what makes it unflattenable, exactly as in Q2א above, and the plan
 * becomes `Index Scan using isi_run`, one probe per run — on that same 5% case
 * the join subtree read 113 buffers instead of 307, and the statement 686
 * instead of 880. The point is the SHAPE, not those numbers: the plain join's
 * interval scan is the size of the whole open set no matter how narrow the
 * filter, and the lateral's is the size of the surviving run set.
 *
 * No index was added for this. isi_run already serves the probe (§6.2 lists it
 * for the attempt_no count) and the restructure is what changes the plan: a
 * partial `(route_run_id) WHERE upper_inf(valid_range)` was measured too, and
 * on the OLD text it changed nothing at all — the bitmap scan simply used it
 * instead of isi_one_open_per_item. Paired with the lateral it does help (each
 * probe reads the run's one open row instead of its ~10 intervals: 1,930
 * buffers instead of 4,385), but §6.2's add-back rule wants a dominant scan AND
 * an endpoint p95 over §6.4's 2s, and Q7 is now ~250-330ms. Numbers recorded
 * here so the trade is re-openable without re-measuring it.
 *
 * Folding the per-state counts into the lateral also removes a latent fan-out:
 * a run with two open intervals used to contribute two rows, double-weighting
 * it in avg_route_turnaround_*. One lateral row per run makes the turnaround a
 * per-run average by construction. (Fan-out is 1 for all 630 runs here, so the
 * output is unchanged — verified row-by-row across scope/filter combinations.)
 *
 * shipments.amount is a STOCK number and never the denominator of a test ratio:
 * completion_pct is finished_runs/routed_runs, coverage_pct is a separate
 * number with a separate name.
 *
 * item type groups by count(DISTINCT route_run_id), NOT unit_id — accessories
 * share a unit_id with their parent but carry their own type, and unit_id there
 * undercounts by ~4x.
 */
export function buildEntityProgress(
  entity: ProgressEntity,
  filters: MetricFilters = {}
): Built {
  const scope: MetricsScope = filters.scope === "all" ? "all" : "open_shipments";
  const params = [
    scope,
    filters.customerId ?? null,
    filters.shipmentId ?? null,
    filters.itemTypeId ?? null,
    filters.parentsOnly === true,
  ];

  // Applied to route_run inside the LEFT JOIN's ON, so an entity with no open
  // runs stays in the result as zeros instead of being silently dropped — the
  // "LEFT JOIN that decayed into an INNER" defect of §9.4.
  //
  // rr.is_trusted is here for the same reason buildFinishedCumulative,
  // finishedInWindow and completion-series all carry it: "finished" is a
  // route_run closure (§5.3ב), and a Tier-2 backfill (§8 stage 4) writes runs
  // with is_trusted = false. Without this predicate Q7's finished_runs and
  // completion_pct would count closures that the cumulative series and the KPI
  // card refuse to count, and a screen showing both would contradict itself.
  // The omission is invisible today only because Tier 2 is "do not run" and
  // every one of the 630 runs on this database is trusted — a latent defect,
  // armed by a decision someone may still take.
  const runOn = `
      AND rr.is_trusted
      AND ($2::int IS NULL OR rr.customer_id  = $2)
      AND ($3::int IS NULL OR rr.shipment_id  = $3)
      AND ($4::int IS NULL OR rr.item_type_id = $4)
      AND (NOT $5::boolean OR rr.is_accessory = false)
      AND ($1::text = 'all'
           OR EXISTS (SELECT 1 FROM shipments s_flt
                       WHERE s_flt.id = rr.shipment_id AND s_flt.is_sent IS NOT TRUE))`;

  const shared = `
       count(DISTINCT rr.route_run_id)                                         AS routed_runs,
       count(DISTINCT rr.unit_id)                                              AS routed_units,
       count(DISTINCT rr.route_run_id) FILTER (WHERE rr.closed_at IS NOT NULL) AS finished_runs,
       -- Summing the lateral's per-run counts, not counting joined rows: the
       -- open-interval lookup lives inside the LATERAL now (see the header).
       COALESCE(sum(i.in_queue), 0)                            AS in_queue,
       COALESCE(sum(i.in_test), 0)                             AS in_test,
       COALESCE(sum(i.waiting_research), 0)                    AS waiting_research,
       COALESCE(sum(i.in_research), 0)                         AS in_research,
       COALESCE(sum(i.finished), 0)                            AS finished,
       round(100.0 * count(DISTINCT rr.route_run_id) FILTER (WHERE rr.closed_at IS NOT NULL)
             / NULLIF(count(DISTINCT rr.route_run_id), 0), 1)                  AS completion_pct,
       -- Both clocks carry the SAME filter. Without it the pair desynchronises:
       -- EXTRACT(EPOCH FROM (NULL - opened_at)) is NULL and avg() skips it, but
       -- work_seconds_between(a, NULL) returns 0, because LEAST/GREATEST ignore
       -- NULLs and the ladder subtracts the same offset from itself. Every open
       -- run would then pull the work average toward zero while leaving the wall
       -- average untouched — two clocks that disagree by construction (§5.0(10)).
       avg(EXTRACT(EPOCH FROM (rr.closed_at - rr.opened_at)))
         FILTER (WHERE rr.closed_at IS NOT NULL)/60                            AS avg_route_turnaround_wall_min,
       avg(work_seconds_between(rr.opened_at, rr.closed_at))
         FILTER (WHERE rr.closed_at IS NOT NULL)/60                            AS avg_route_turnaround_work_min`;

  const intervalJoin = `
LEFT JOIN LATERAL (
  SELECT count(*) FILTER (WHERE ii.state_key = 'queued')          AS in_queue,
         count(*) FILTER (WHERE ii.state_key = 'testing')         AS in_test,
         count(*) FILTER (WHERE ii.state_key = 'queued_research') AS waiting_research,
         count(*) FILTER (WHERE ii.state_key = 'in_research')     AS in_research,
         count(*) FILTER (WHERE ii.state_key = 'done')            AS finished
  FROM item_state_interval ii
  WHERE ii.route_run_id = rr.route_run_id AND upper_inf(ii.valid_range)
) i ON true`;

  // THE UNIT COUNT IS COMPUTED ONCE, HERE, AND REFERENCED TWICE.
  //
  // The customer and item-type variants need the same number in two places —
  // `declared_amount` and the denominator of `coverage_pct`. Written as two
  // copies of the same correlated subquery (the shape §5.8 implies) PostgreSQL
  // plans them as two independent SubPlans, each costed at ~1,889 per outer
  // row, and the ESTIMATED cost of the whole statement crosses both JIT
  // thresholds: customer 645,026 and item type 1,287,428 against
  // jit_above_cost = 100,000 and jit_optimize_above_cost = 500,000. Measured on
  // this database the customer variant then spent 797ms of its 1,045ms inside
  // LLVM (Functions: 79, Inlining + Optimization on) to plan a query whose real
  // work is six rows. As one grouped CTE joined on the dimension key the same
  // scan is done once: 4,591 with the old join, 13,681 with the per-run lateral
  // above — either way an order of magnitude under jit_above_cost, no JIT block
  // is emitted at all, and the statement runs in ~250ms instead of ~1,050ms.
  // NOT fixed with `SET jit` / `jit_above_cost`: the cost estimate was honest
  // about the text, and the text was the defect.
  //
  // COALESCE on the outside keeps the LEFT JOIN's NULL identical to the
  // subquery's `count(*) = 0`; the coverage denominator stays NULLIF(...,0), so
  // an entity with no items still reports NULL coverage rather than 0.
  const declaredCte = (dimColumn: string, parentsPredicate: string) => `WITH declared AS (
  SELECT it.${dimColumn} AS entity_id, count(*) AS n
  FROM items it
  WHERE ${parentsPredicate}
    AND ($1::text = 'all'
         OR EXISTS (SELECT 1 FROM shipments s2
                     WHERE s2.id = it.shipment_id AND s2.is_sent IS NOT TRUE))
  GROUP BY it.${dimColumn}
)
`;

  let sql: string;
  if (entity === "shipment") {
    sql = `
SELECT s.id AS entity_id, TRIM(s.shipment_code) AS entity_code,
       TRIM(s.shipment_code) AS entity_name,
       s.customer_id, TRIM(c.name) AS customer_name, TRIM(c.customer_code) AS customer_code,
       s.shipment_date,
       s.amount AS declared_amount,${shared},
       round(100.0 * count(DISTINCT rr.unit_id) / NULLIF(s.amount, 0), 1)      AS coverage_pct,
       -- receipt-to-shipment: the shipping moment lives on shipments
       -- (written in shipment-history/route.ts:81), not on route_run — a
       -- shipment leaves long after its last run closes. shipment_date is
       -- Timestamp(6) without a zone (§7.1), hence the explicit conversion.
       -- Same NULL trap as the route turnaround above: a shipment that has not
       -- left yet has finished_at IS NULL, and work_seconds_between would answer
       -- 0 while the wall column correctly answers NULL. Guarded so an unshipped
       -- shipment reads "not shipped yet" on BOTH clocks.
       CASE WHEN s.finished_at IS NULL OR s.shipment_date IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM (s.finished_at - (s.shipment_date AT TIME ZONE 'UTC')))/60
       END                                                                           AS ship_turnaround_wall_min,
       CASE WHEN s.finished_at IS NULL OR s.shipment_date IS NULL THEN NULL
            ELSE work_seconds_between((s.shipment_date AT TIME ZONE 'UTC'), s.finished_at)/60
       END                                                                           AS ship_turnaround_work_min
FROM shipments s
JOIN customers c ON c.id = s.customer_id
LEFT JOIN route_run rr ON rr.shipment_id = s.id${runOn}${intervalJoin}
WHERE ($1::text = 'all' OR s.is_sent IS NOT TRUE)
GROUP BY s.id, s.shipment_code, s.customer_id, c.name, c.customer_code, s.shipment_date, s.amount, s.finished_at
ORDER BY s.id`;
  } else if (entity === "customer") {
    // THE DENOMINATOR COUNTS UNITS, NOT ITEM ROWS. The numerator of both
    // customer numbers is count(DISTINCT rr.unit_id) (§5.10
    // customer_total_items), and a unit is a PARENT item: an accessory carries
    // its own items row but rides on its parent's unit_id (§4.7, verified on
    // this database: route_run.unit_id = COALESCE(parent_item_id, item_id) for
    // all 630 runs). Counting every items row here divided units by items and
    // reported ~82% coverage for a customer whose every unit is routed —
    // measured before that fix: customer 5 read 77.1% (128 units / 166 item
    // rows) where the honest answer is 128/128 = 100%. The parentsOnly flag is
    // therefore not part of this predicate: restricting to parents IS the
    // definition of a unit, not an option.
    sql = `
${declaredCte("customer_id", "it.parent_item_id IS NULL")}SELECT c.id AS entity_id, TRIM(c.customer_code) AS entity_code, TRIM(c.name) AS entity_name,
       c.id AS customer_id, TRIM(c.name) AS customer_name,
       COALESCE(d.n, 0) AS declared_amount,${shared},
       round(100.0 * count(DISTINCT rr.unit_id) / NULLIF(d.n, 0), 1)           AS coverage_pct
FROM customers c
LEFT JOIN declared d ON d.entity_id = c.id
LEFT JOIN route_run rr ON rr.customer_id = c.id${runOn}${intervalJoin}
GROUP BY c.id, c.customer_code, c.name, d.n
ORDER BY c.id`;
  } else {
    sql = `
${declaredCte("item_type_id", "(NOT $5::boolean OR it.parent_item_id IS NULL)")}SELECT ity.item_type_id AS entity_id, NULL::text AS entity_code,
       TRIM(ity.item_type_desc) AS entity_name,
       COALESCE(d.n, 0) AS declared_amount,${shared},
       round(100.0 * count(DISTINCT rr.route_run_id) / NULLIF(d.n, 0), 1)      AS coverage_pct
FROM item_types ity
LEFT JOIN declared d ON d.entity_id = ity.item_type_id
LEFT JOIN route_run rr ON rr.item_type_id = ity.item_type_id${runOn}${intervalJoin}
GROUP BY ity.item_type_id, ity.item_type_desc, d.n
ORDER BY ity.item_type_id`;
  }

  return { sql, params };
}

/**
 * Filters Q7 cannot express. §5.8's query is anchored on route_run and the
 * entity's own table; station, station type, worker, serial and status are
 * per-STEP facts that no longer identify an entity once the run is the unit.
 * Named here so a caller can surface them instead of quietly answering a
 * different question than the one the filter bar asked (§5.0).
 */
export function entityProgressIgnored(filters: MetricFilters = {}): string[] {
  const out: string[] = [];
  if (filters.stationId != null) out.push("stationId");
  if (filters.stationTypeId != null) out.push("stationTypeId");
  if (filters.workerId != null) out.push("workerId");
  if (filters.itemSerial) out.push("itemSerial");
  if (filters.states && filters.states.length > 0) out.push("states");
  return out;
}

export async function entityProgress(
  client: MetricsClient,
  entity: ProgressEntity,
  filters: MetricFilters = {}
): Promise<EntityProgressRow[]> {
  const b = buildEntityProgress(entity, filters);
  const rows = await run<Raw>(client, `Q7 entityProgress(${entity})`, b.sql, b.params);
  return rows.map((r) => ({
    entity_id: cnt(r.entity_id),
    entity_code: str(r.entity_code),
    entity_name: str(r.entity_name),
    ...(r.customer_id !== undefined ? { customer_id: num(r.customer_id), customer_name: str(r.customer_name) } : {}),
    ...(r.customer_code !== undefined ? { customer_code: str(r.customer_code) } : {}),
    ...(r.shipment_date !== undefined ? { shipment_date: (r.shipment_date as Date | string | null) ?? null } : {}),
    declared_amount: num(r.declared_amount),
    routed_runs: cnt(r.routed_runs),
    routed_units: cnt(r.routed_units),
    finished_runs: cnt(r.finished_runs),
    in_queue: cnt(r.in_queue),
    in_test: cnt(r.in_test),
    waiting_research: cnt(r.waiting_research),
    in_research: cnt(r.in_research),
    finished: cnt(r.finished),
    completion_pct: num(r.completion_pct),
    coverage_pct: num(r.coverage_pct),
    avg_route_turnaround_wall_min: num(r.avg_route_turnaround_wall_min),
    avg_route_turnaround_work_min: num(r.avg_route_turnaround_work_min),
    ...(r.ship_turnaround_wall_min !== undefined
      ? {
          ship_turnaround_wall_min: num(r.ship_turnaround_wall_min),
          ship_turnaround_work_min: num(r.ship_turnaround_work_min),
        }
      : {}),
  }));
}

// ===========================================================================
// Q8 — §5.9 quality, rework and research turnaround
// ===========================================================================

export interface QualityRow {
  d: BusinessDay;
  station_type_id: number | null;
  results_recorded: number;
  passed: number;
  failed: number;
  fail_pct: number | null;
  rework_steps: number;
  rework_pct: number | null;
  avg_research_wait_wall_min: number | null;
  avg_research_wait_work_min: number | null;
  avg_research_wall_min: number | null;
  avg_research_work_min: number | null;
}

/**
 * NO CONSUMER YET. Nothing in src/ or scripts/ calls {@link quality}: stage 5
 * rewrote the ten existing dashboard endpoints, and none of them is a quality
 * screen. Q8 ships anyway because §5.9's metrics are wanted and the definitions
 * are the hard part — the KPI card "failed / returns" shows a hardcoded "-"
 * today while `test_results.passed` is written and nobody reads it, and
 * `fail_pct` is exactly that number. It is a definition waiting for a screen
 * (stage 6), not code that some route quietly depends on; deleting it would
 * only mean re-deriving §5.9 later. Kept, and said out loud rather than left
 * for the next reader to discover with a grep.
 *
 * `tr.state_event_id = i.exit_event_id` relies on call site #14 INCLUDING #5
 * (§4.5): an `in_research` interval almost always closes as `returned_to_route`,
 * and the test_results row for that submission must point at event #5 or the
 * dominant research outcome disappears from these columns.
 */
export function buildQuality(from: BusinessDay, to: BusinessDay, filters: MetricFilters = {}): Built {
  const sql = `
-- THE RESEARCH INTERVALS OF THE GROUP'S RUNS ARE READ ONCE, NOT FOUR TIMES.
-- These four numbers were four correlated subqueries over the same
-- route_run_id = ANY(array_agg(DISTINCT i.route_run_id)) set, differing only in
-- state_key and in which clock they averaged. PostgreSQL planned them as four
-- independent SubPlans, each re-scanning the same rows, and the estimated cost
-- of the statement reached 699,200 — past jit_above_cost (100,000) AND past
-- jit_optimize_above_cost (500,000), so it compiled with inlining and
-- optimisation on: measured over 13 months, 1,007-1,203ms of LLVM inside a
-- 1,048-1,244ms statement whose real work is 844 rows. Same defect and same fix
-- as Q7's declared CTE — the cost estimate was honest about the text, and the
-- text was the defect. NOT fixed with SET jit / jit_above_cost.
--
-- The set is the same set, spelled as a join instead of as an array: the runs
-- of a group, DISTINCT, joined to their research intervals and aggregated once
-- per group. (A LATERAL over array_agg was measured too and is the obvious
-- transcription, but it keeps a per-group index probe costed at 270 and lands
-- at 180,842 — still over jit_above_cost. The join is one hash pass.)
WITH base AS (
  SELECT i.close_business_date AS bd, i.station_type_id, i.route_run_id,
         i.entry_reason, i.exit_event_id
  FROM item_state_interval i
  JOIN metric_state ms ON ms.state_key = i.state_key AND ms.is_active_work
  WHERE i.close_business_date BETWEEN $1::date AND $2::date
    AND i.closed_at IS NOT NULL AND i.is_trusted${intervalFilterSql("i", 3)}
), research AS (
  SELECT u.bd, u.station_type_id,
         avg(x.wall_seconds) FILTER (WHERE x.state_key = 'queued_research')/60 AS avg_research_wait_wall_min,
         avg(x.work_seconds) FILTER (WHERE x.state_key = 'queued_research')/60 AS avg_research_wait_work_min,
         avg(x.wall_seconds) FILTER (WHERE x.state_key = 'in_research')/60     AS avg_research_wall_min,
         avg(x.work_seconds) FILTER (WHERE x.state_key = 'in_research')/60     AS avg_research_work_min
  FROM (SELECT DISTINCT bd, station_type_id, route_run_id FROM base) u
  JOIN item_state_interval x ON x.route_run_id = u.route_run_id
   AND x.state_key IN ('queued_research', 'in_research')
   AND x.closed_at IS NOT NULL
  GROUP BY 1, 2
)
SELECT to_char(b.bd, 'YYYY-MM-DD') AS d, b.station_type_id,
       count(tr.*)                                                 AS results_recorded,
       count(*) FILTER (WHERE tr.passed)                           AS passed,
       count(*) FILTER (WHERE tr.passed = false)                   AS failed,
       round(100.0*count(*) FILTER (WHERE tr.passed = false)/NULLIF(count(tr.*),0),1) AS fail_pct,
       count(*) FILTER (WHERE b.entry_reason = 'returned_to_route') AS rework_steps,
       round(100.0*count(*) FILTER (WHERE b.entry_reason = 'returned_to_route')
             /NULLIF(count(*),0),1)                                 AS rework_pct,
       -- A group whose runs never went to research has no research row, and the
       -- four columns stay NULL — which is what avg() over no rows answered.
       r.avg_research_wait_wall_min, r.avg_research_wait_work_min,
       r.avg_research_wall_min, r.avg_research_work_min
FROM base b
LEFT JOIN test_results tr ON tr.state_event_id = b.exit_event_id
-- IS NOT DISTINCT FROM, not =: an interval whose station_type_id is NULL is a
-- real group here, and = would drop its research numbers.
LEFT JOIN research r ON r.bd = b.bd
                    AND r.station_type_id IS NOT DISTINCT FROM b.station_type_id
GROUP BY b.bd, b.station_type_id,
         r.avg_research_wait_wall_min, r.avg_research_wait_work_min,
         r.avg_research_wall_min, r.avg_research_work_min
ORDER BY 1, 2`;
  return { sql, params: [from, to, ...intervalFilterParams(filters)] };
}

export async function quality(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  filters: MetricFilters = {}
): Promise<QualityRow[]> {
  const b = buildQuality(from, to, filters);
  const rows = await run<Raw>(client, "Q8 quality", b.sql, b.params);
  return rows.map((r) => ({
    d: String(r.d),
    station_type_id: num(r.station_type_id),
    results_recorded: cnt(r.results_recorded),
    passed: cnt(r.passed),
    failed: cnt(r.failed),
    fail_pct: num(r.fail_pct),
    rework_steps: cnt(r.rework_steps),
    rework_pct: num(r.rework_pct),
    avg_research_wait_wall_min: num(r.avg_research_wait_wall_min),
    avg_research_wait_work_min: num(r.avg_research_wait_work_min),
    avg_research_wall_min: num(r.avg_research_wall_min),
    avg_research_work_min: num(r.avg_research_work_min),
  }));
}

// ---------------------------------------------------------------------------
// Registry — the catalogue of §5 statements, and the §5.0(9) build-time sweep
// ---------------------------------------------------------------------------

export const QUERY_BUILDERS = {
  Q1: buildPointInTime,
  Q2a: buildPitSeries,
  Q2b: buildFinishedCumulative,
  Q3: buildStationBoard,
  Q4: buildFlow,
  Q5: buildKpiWindow,
  Q6: buildSlowSteps,
  Q7: buildEntityProgress,
  Q8: buildQuality,
} as const;

// Arbitrary but well-formed arguments: the sweep reads the SQL text, never runs
// it, so only the shape of the statement depends on these.
const SWEEP_FROM = "2026-01-01";
const SWEEP_TO = "2026-08-01";
const SWEEP_FROM_TS = "2026-01-01T00:00:00Z";
const SWEEP_TO_TS = "2026-08-01T00:00:00Z";

/**
 * Every statement in the catalogue, built with representative arguments.
 *
 * Every SHAPE, not every builder: the shape of a statement is what the §5.0(9)
 * lint reads, and Q4's shape changes with the dimension (the units_processed
 * column) while Q7's changes with the entity (three different FROMs). One call
 * per builder would leave those variants unswept. No database is touched — the
 * builders are pure string assembly.
 */
export function allBuiltStatements(): Built[] {
  const out: Built[] = [];
  const push = (label: string, b: Built) => out.push({ ...b, sql: `-- ${label}\n${b.sql}` });
  push("Q1 pointInTime", QUERY_BUILDERS.Q1(SWEEP_TO_TS));
  push("Q2a pitSeries", QUERY_BUILDERS.Q2a(SWEEP_FROM, SWEEP_TO));
  push("Q2b finishedCumulative", QUERY_BUILDERS.Q2b(SWEEP_FROM, SWEEP_TO));
  push("Q3 stationBoard", QUERY_BUILDERS.Q3());
  for (const dimension of Object.keys(DIMENSIONS) as FlowDimension[]) {
    for (const family of ["active_work", "waiting"] as FlowFamily[]) {
      push(`Q4 flow(${dimension},${family})`, QUERY_BUILDERS.Q4(SWEEP_FROM, SWEEP_TO, {}, { dimension, family }));
    }
  }
  for (const dimension of Object.keys(KPI_DIM_COLUMN) as KpiDimension[]) {
    push(`Q5 kpiWindow(${dimension})`, QUERY_BUILDERS.Q5(SWEEP_FROM_TS, SWEEP_TO_TS, {}, dimension));
  }
  push("Q6 slowSteps", QUERY_BUILDERS.Q6(SWEEP_FROM, SWEEP_TO));
  for (const entity of ["shipment", "customer", "item_type"] as ProgressEntity[]) {
    push(`Q7 entityProgress(${entity})`, QUERY_BUILDERS.Q7(entity));
  }
  push("Q8 quality", QUERY_BUILDERS.Q8(SWEEP_FROM, SWEEP_TO));
  return out;
}

/**
 * Run the §5.0(9) lint over the whole catalogue. Throws on the first statement
 * whose range probe has lost its `NOT <alias>.is_terminal`.
 *
 * WHY IT RUNS AT MODULE LOAD. The per-request call in {@link run} checks only
 * the one statement someone happened to load, and only once it is already
 * serving traffic: a dropped predicate is then an HTTP 500, or worse a
 * 120-second page, not a failure anyone saw coming. The sweep checks all of
 * them, once, when the module is first imported — verified: with one
 * `NOT q.is_terminal` removed from Q3, `import("./queries")` throws
 * "Q3 stationBoard: range probe on q.valid_range without NOT <alias>.is_terminal
 * in the same clause" before any caller exists. Every dashboard route imports
 * this module, so that is build/startup time rather than request time. The cost
 * is 32 string builds and a regex pass, no I/O.
 *
 * Exported so a unit test can assert the same thing without relying on an
 * import side effect.
 */
export function guardAllBuilders(): void {
  for (const b of allBuiltStatements()) {
    const label = b.sql.slice(3, b.sql.indexOf("\n"));
    guardRangeProbes(b.sql, label);
  }
}

guardAllBuilders();

export { FILTER_PARAM_COUNT, RUN_FILTER_PARAM_COUNT };
export type { MetricFilters, MetricsScope };
