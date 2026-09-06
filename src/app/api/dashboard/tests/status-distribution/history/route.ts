// Q2 — §5.3. The point-in-time series (Q2א) plus the cumulative finished
// series (Q2ב), replacing the status_distribution_snapshots{,_monthly} read.
//
// WHAT THE OLD ROUTE DID. It read a snapshot table chosen by date range, then
// OVERWROTE today's point with a live COUNT over item_routes.current_status —
// two different definitions of the same line on one chart, with today's point
// computed a third way. The snapshots themselves are garbage by construction
// (§8) and are deleted in stage 7.
//
// WHAT THIS DOES.
//  - Q2א samples the ledger at 12:00 Asia/Jerusalem on every civil day of the
//    window. The §5.1 filter block lives inside the LEFT JOIN's ON, not the
//    WHERE, so a day with no matching rows survives as a zero instead of
//    vanishing from the series, and no value is ever carried forward (§5.0(7)).
//  - Q2ג adds the daily throughput pair — `_new_workStartedToday` (the day a
//    run's FIRST active-work interval opened) and `_new_workFinishedToday` (the
//    day it closed). Accessories are out of both, because an accessory's
//    `testing` interval is a synthetic ~0-length pair and it is never worked on
//    (111 of 630 runs here — 18%, enough to move the line).
//  - Q2ב is the ONE definition of "finished" (§5.3ב): a running sum of
//    route_run closures, counted once on the day they happened. It is
//    entry-anchored, so it does not depend on a sampling instant, and it is
//    what makes the "הושלם" line meaningful again — Q2א is the ACTIVE
//    population and deliberately carries no terminal state (§5.2).
//
// THE TWO SERIES ARE NAMED, NOT MIXED. The cumulative entry carries
// `_new_series: "cumulative"`; every other entry is `"point_in_time"`. Its
// `percentage` is null on purpose: a running total has no share of a snapshot.
//
// §5.0(1): this is a HISTORICAL endpoint, so its scope is the constant `all`.
// Filtering thirteen months of history by "shipments not sent yet" would let
// the past rewrite itself every time a shipment ships.
//
// §6.3: the chart's "3 years" preset is capped at 13 months, and the cap is
// reported in the X-Metrics-Period-* headers rather than applied in silence.
// The grid stays daily at every preset — the component already aggregates to
// weekly above 30 points, and inventing a coarser bucket server-side would be a
// second definition of the same series.

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { finishedCumulative, pitSeries, workThroughput } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  labelOf,
  legacyStatusOf,
  metricStates,
  metricsJson,
  qualify,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";

export const runtime = "nodejs";

interface StatusPoint {
  status: string;
  statusName: string;
  count: number;
  percentage: number | null;
  _new_stateKey: string;
  _new_series: "point_in_time" | "cumulative";
}

interface HistoryPoint {
  date: string;
  statuses: StatusPoint[];
  isToday: boolean;
  /** §5.3ב — route_run closures to date, the same number as the `done` entry. */
  finishedCumulative: number;
  /** Closures on this day alone. Additive; the cumulative series is not.
   *  Counts EVERY run, accessories included — the same population as the KPI
   *  card's `מסלולים שנסגרו`. */
  _new_finishedToday: number;
  /** Q2ג — the daily throughput PAIR: work begun against work completed, over
   *  ONE population with accessories excluded from both sides. `workStarted` is
   *  the day a run's first `testing` interval opened (its first station);
   *  `workFinished` is the day the run closed (its last station). They are
   *  comparable to each other and deliberately not to `_new_finishedToday`,
   *  which keeps accessories — roughly three of every four runs here. */
  _new_workStartedToday: number;
  _new_workFinishedToday: number;
  /** Sum of the active states at this point — the percentage denominator. */
  _new_activeTotal: number;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    const period = requirePeriod(searchParams);
    const filters = { ...filtersFromSearchParams(searchParams), scope: "all" as const };

    const [series, finished, throughput, states] = await Promise.all([
      pitSeries(prisma, period.from, period.to, filters),
      finishedCumulative(prisma, period.from, period.to, filters),
      workThroughput(prisma, period.from, period.to, filters),
      metricStates(prisma),
    ]);

    const byDay = new Map<string, HistoryPoint>();
    const dayOf = (d: string): HistoryPoint => {
      let p = byDay.get(d);
      if (!p) {
        byDay.set(
          d,
          (p = {
            date: d,
            statuses: [],
            isToday: d === period.today,
            finishedCumulative: 0,
            _new_finishedToday: 0,
            _new_workStartedToday: 0,
            _new_workFinishedToday: 0,
            _new_activeTotal: 0,
          })
        );
      }
      return p;
    };

    // A state that is zero on EVERY point of the window is dropped from the
    // series entirely. This is not gap-filling and not carry-forward (§5.0(7)):
    // a state that occurred even once keeps its zero days, which is the case the
    // rule is about. It is `unmapped` this removes — metric_state carries it as
    // a non-terminal state, so Q2א's CROSS JOIN emits a zero row for it on every
    // grid day, and the chart would draw a permanent flat line for a status that
    // has never existed.
    const everSeen = new Set(series.filter((r) => r.items > 0).map((r) => r.state_key));

    // Q2א — the active population, in metric_state.sort_order (the query
    // already returns it that way, so the chart's series order is stable).
    for (const r of series) {
      const p = dayOf(r.business_day);
      if (!everSeen.has(r.state_key)) continue;
      p.statuses.push({
        status: legacyStatusOf(states, r.state_key),
        statusName: r.label_he,
        count: r.items,
        percentage: null, // filled once the day's total is known
        _new_stateKey: r.state_key,
        _new_series: "point_in_time",
      });
      p._new_activeTotal += r.items;
    }

    // Q2ב — the cumulative closures.
    for (const r of finished.rows) {
      const p = dayOf(r.business_day);
      p.finishedCumulative = r.finished_cumulative;
      p._new_finishedToday = r.finished_today;
    }

    // Q2ג — work begun against work completed, one population, both bucketed on
    // the Asia/Jerusalem business day.
    for (const r of throughput.rows) {
      const p = dayOf(r.business_day);
      p._new_workStartedToday = r.started;
      p._new_workFinishedToday = r.finished;
    }

    // A `status` filter that excludes `done` must exclude the finished line too,
    // otherwise the legend would contradict the filter.
    const showFinished = !filters.states || filters.states.includes("done");

    const data: HistoryPoint[] = [...byDay.values()]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((p) => {
        for (const s of p.statuses) {
          s.percentage =
            p._new_activeTotal > 0
              ? Math.round((s.count / p._new_activeTotal) * 1000) / 10
              : 0;
        }
        if (showFinished) {
          p.statuses.push({
            status: legacyStatusOf(states, "done"),
            statusName: labelOf(states, "done"),
            count: p.finishedCumulative,
            percentage: null,
            _new_stateKey: "done",
            _new_series: "cumulative",
          });
        }
        return p;
      });

    // Q2א honours the whole filter block; Q2ב cannot express station, station
    // type, worker or state. With a station filter the point-in-time lines are
    // narrowed and the cumulative "finished" line is not — the header says so
    // per-metric rather than leaving a reader to guess (§5.0(1)).
    return metricsJson(
      data,
      period,
      filters,
      [
        ...qualify("finishedCumulative", finished.ignoredFilters),
        ...qualify("workThroughput", throughput.ignoredFilters),
      ]
    );
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching status distribution history:", error);
    return NextResponse.json(
      { error: "Failed to fetch status distribution history" },
      { status: 500 }
    );
  }
}, { role: "manager" });
