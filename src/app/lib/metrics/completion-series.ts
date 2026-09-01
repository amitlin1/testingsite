// `completion_history_percentage` — §5.10, the last row of the shipment family:
//
//     completion_history_percentage | Q2ב + Q7 | replaces stats/completion-history
//
// Q2ב's shape (§5.3ב), carried per shipment. It lives here rather than in
// queries.ts because queries.ts owns Q1..Q8 exactly as §5.2..§5.9 write them and
// is shared with the parity harness; this is the one composite the catalogue
// names but does not spell out. It borrows the §5.1 filter block from
// filters.ts, so the filter set is still written once, and it runs through
// queries.ts's guardRangeProbes for the same reason every other statement does.
//
// THE DEFINITION
// --------------
// For a shipment and a business day D:
//
//     routed_runs(D)   = route_runs of that shipment OPENED on or before D
//     finished_runs(D) = route_runs of that shipment CLOSED on or before D
//     completion(D)    = 100 * finished_runs(D) / routed_runs(D)
//
// Three things this is deliberately NOT:
//
//  1. NOT shipments.amount in the denominator. amount is an inventory number
//     (§5.8, §2.7) and it is what froze shipment_snapshots.completion_percentage
//     near zero — the defect that made the old table unusable and unfixable by
//     re-reading it. Completion is measured against the ROUTED population.
//  2. NOT a sample of terminal intervals. "Finished" is a route_run closure and
//     nothing else (§5.3ב). `done` is an interval that stays open forever, so
//     probing it with `@>` would rescan all of history at every grid point and
//     answer a different question besides.
//  3. NOT gap-filled. A day on which the shipment had no run open yet has a
//     zero denominator, and the series carries NULL there rather than a
//     fabricated 0% (§5.0(7)). The chart's connectNulls already handles it.
//
// The denominator moves with the day: a run opened on the 10th is not part of
// the 9th's population. That is what makes the series genuinely point-in-time
// (§2.4) instead of a present-day ratio painted backwards over history.
//
// A CONSEQUENCE WORTH STATING: the curve can go DOWN. Shipment 73 on the seeded
// dataset reads 25 / 25 / 25 / 75 / 100 / 63.6 across 2026-08-23..28 — four runs
// were routed and finished, then seven more were routed on the last day. That is
// the truth about the shipment, and a fixed present-day denominator would have
// hidden it by drawing the whole history against a population that did not exist
// yet.
//
// There is no second clock here on purpose. §2.8's rule is about DURATIONS —
// every duration exists as a wall/work pair. A completion ratio is a count over
// a count; it has no clock to pair.

import {
  runFilterParams,
  runFilterSql,
  RUN_FILTER_PARAM_COUNT,
  type MetricFilters,
} from "./filters";
import { guardRangeProbes, type MetricsClient } from "./queries";
import { addDays, addMonths, type BusinessDay, type Granularity } from "./period";

export interface CompletionSeriesRow {
  business_day: BusinessDay;
  shipment_id: number;
  shipment_code: string;
  /** Runs of this shipment opened on or before business_day. */
  routed_runs: number;
  /** Runs of this shipment closed on or before business_day (§5.3ב). */
  finished_runs: number;
  /** NULL when nothing was routed yet — never 0 (§5.0(7)). */
  completion_pct: number | null;
}

// ---------------------------------------------------------------------------
// Sample days
// ---------------------------------------------------------------------------

function firstOfBucket(day: BusinessDay, g: Granularity): BusinessDay {
  const [y, m] = day.split("-").map(Number);
  const month = g === "quarterly" ? 1 + 3 * Math.floor((m - 1) / 3) : m;
  return `${String(y).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/**
 * The days the series is reported at.
 *
 * `daily` is every day in the window. `monthly` / `quarterly` report the LAST
 * day of each bucket — a cumulative curve is only meaningful at a bucket's end,
 * and the end is where the old monthly snapshot stood. The window's final day is
 * always included, so the newest point is today rather than the end of last
 * month.
 *
 * The cumulative sums are always computed over EVERY day (see the SQL); only the
 * reporting is sparse. Summing a coarse grid over its own points would drop the
 * days between them.
 */
export function sampleDays(from: BusinessDay, to: BusinessDay, g: Granularity): BusinessDay[] {
  if (from > to) return [];
  if (g === "daily") {
    const out: BusinessDay[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  const step = g === "quarterly" ? 3 : 1;
  const out: BusinessDay[] = [];
  let bucket = firstOfBucket(from, g);
  // Guarded loop: addMonths always advances, so this terminates; the bound is
  // the 13-month UI ceiling (§6.3) plus slack.
  for (let i = 0; i < 200; i++) {
    const end = addDays(addMonths(bucket, step), -1);
    if (end >= from && end < to) out.push(end);
    if (end >= to) break;
    bucket = addMonths(bucket, step);
  }
  out.push(to);
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

export function buildCompletionSeries(
  from: BusinessDay,
  to: BusinessDay,
  days: readonly BusinessDay[],
  filters: MetricFilters = {}
): { sql: string; params: unknown[] } {
  // $1 from, $2 to, $3..$(2+RUN_FILTER_PARAM_COUNT) the §5.1 run-side block,
  // then the sample-day array.
  const daysOrdinal = 3 + RUN_FILTER_PARAM_COUNT;
  const sql = `
WITH grid AS (
  -- Civil dates, never timestamptz + interval '1 day' — the latter leaks an
  -- hour across every DST boundary and loses a point (§7.3, verified on PG16).
  SELECT d::date AS business_day
  FROM generate_series($1::date, $2::date, interval '1 day') d
), runs AS (
  SELECT rr.shipment_id,
         business_date(rr.opened_at) AS opened_bd,
         business_date(rr.closed_at) AS closed_bd   -- NULL-safe: NULL in, NULL out
  FROM route_run rr
  WHERE rr.is_trusted AND rr.shipment_id IS NOT NULL${runFilterSql("rr", 3)}
), daily AS (
  SELECT shipment_id, bd, sum(opened)::int AS opened, sum(closed)::int AS closed
  FROM (
    SELECT shipment_id, opened_bd AS bd, 1 AS opened, 0 AS closed FROM runs
    UNION ALL
    SELECT shipment_id, closed_bd AS bd, 0 AS opened, 1 AS closed
      FROM runs WHERE closed_bd IS NOT NULL
  ) e
  WHERE bd IS NOT NULL
  GROUP BY 1, 2
), base AS (
  -- Everything that happened before the window, so the first point of the
  -- series is a real cumulative value and not a restart from zero.
  SELECT shipment_id, COALESCE(sum(opened), 0)::int AS opened0,
         COALESCE(sum(closed), 0)::int AS closed0
  FROM daily WHERE bd < $1::date GROUP BY 1
), ships AS (
  SELECT DISTINCT shipment_id FROM daily WHERE bd <= $2::date
), series AS (
  SELECT g.business_day, sp.shipment_id,
         COALESCE(b.opened0, 0) + COALESCE(sum(d.opened) OVER w, 0) AS routed_runs,
         COALESCE(b.closed0, 0) + COALESCE(sum(d.closed) OVER w, 0) AS finished_runs
  FROM grid g
  CROSS JOIN ships sp
  LEFT JOIN base  b ON b.shipment_id = sp.shipment_id
  LEFT JOIN daily d ON d.shipment_id = sp.shipment_id AND d.bd = g.business_day
  WINDOW w AS (PARTITION BY sp.shipment_id ORDER BY g.business_day)
)
SELECT to_char(s.business_day, 'YYYY-MM-DD') AS business_day,
       s.shipment_id,
       TRIM(sh.shipment_code) AS shipment_code,
       s.routed_runs, s.finished_runs,
       -- §2.7: the ratio is computed in the SELECT, never stored.
       round(100.0 * s.finished_runs / NULLIF(s.routed_runs, 0), 1) AS completion_pct
FROM series s
JOIN shipments sh ON sh.id = s.shipment_id
-- The cumulative sums above ran over the dense daily grid; the reporting grain
-- is applied here, after them.
WHERE s.business_day = ANY($${daysOrdinal}::date[])
ORDER BY s.business_day, sh.shipment_code`;
  return { sql, params: [from, to, ...runFilterParams(filters), [...days]] };
}

export async function completionSeries(
  client: MetricsClient,
  from: BusinessDay,
  to: BusinessDay,
  days: readonly BusinessDay[],
  filters: MetricFilters = {}
): Promise<CompletionSeriesRow[]> {
  if (days.length === 0) return [];
  const b = buildCompletionSeries(from, to, days, filters);
  const rows =
    (await client.$queryRawUnsafe<Record<string, unknown>[]>(
      guardRangeProbes(b.sql, "Q2b completionSeries"),
      ...b.params
    )) ?? [];
  return rows.map((r) => ({
    business_day: String(r.business_day),
    shipment_id: Number(r.shipment_id),
    shipment_code: String(r.shipment_code ?? ""),
    routed_runs: Number(r.routed_runs ?? 0),
    finished_runs: Number(r.finished_runs ?? 0),
    completion_pct:
      r.completion_pct === null || r.completion_pct === undefined ? null : Number(r.completion_pct),
  }));
}

/** Filters this series cannot express — route_run has no per-step dimension. */
export function completionSeriesIgnored(f: MetricFilters = {}): string[] {
  const out: string[] = [];
  if (f.stationId != null) out.push("stationId");
  if (f.stationTypeId != null) out.push("stationTypeId");
  if (f.workerId != null) out.push("workerId");
  if (f.states && f.states.length > 0) out.push("states");
  return out;
}
