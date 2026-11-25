// The state series behind the status trend and the throughput chart:
//  - Q2א samples the ledger at 12:00 Asia/Jerusalem on every civil day; the
//    filter block sits in the LEFT JOIN's ON, so an empty day is a zero and
//    nothing is carried forward (§5.0(7)).
//  - Q2ב is the ONE definition of "finished" (§5.3ב): a running sum of
//    route_run closures, counted on the day they happened. It rides along as
//    the `done` entry, marked `cumulative`, with a null percentage — a running
//    total has no share of a snapshot.
//  - Q2ג is the daily throughput pair: the day a run's FIRST `testing` interval
//    opened against the day it closed, accessories excluded from both.
//
// Historical (§5.0(1)). The grid is daily at every preset (§6.3's cap applies
// and is reported).

import { prisma } from "@/lib/db";
import type { StatusHistoryEntryWire, StatusHistoryWire } from "@/app/lib/dashboard/contract";
import { dayRows } from "@/app/lib/metrics/read/day-rows";
import { qualify } from "@/app/lib/metrics/read/filters";
import { labelOf, legacyStatusOf, metricStates } from "@/app/lib/metrics/read/metric-state";
import { finishedCumulative, pitSeries, workThroughput } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch status distribution history", async ({ period, filters }) => {
  const [series, finished, throughput, states] = await Promise.all([
    pitSeries(prisma, period.from, period.to, filters),
    finishedCumulative(prisma, period.from, period.to, filters),
    workThroughput(prisma, period.from, period.to, filters),
    metricStates(prisma),
  ]);

  const days = dayRows(
    (date): StatusHistoryWire => ({
      date,
      statuses: [],
      isToday: date === period.today,
      finishedCumulative: 0,
      _new_finishedToday: 0,
      _new_workStartedToday: 0,
      _new_workFinishedToday: 0,
      _new_activeTotal: 0,
    }),
  );

  // A state that is zero on every day of the window is left out of the series.
  // That is `unmapped`: metric_state carries it as a non-terminal state, so Q2א
  // emits a zero row for it on every day, and the chart would draw a permanent
  // flat line for a status that never occurred. A state seen even once keeps
  // its zero days.
  const everSeen = new Set(series.filter((r) => r.items > 0).map((r) => r.state_key));

  for (const r of series) {
    const day = days.at(r.business_day);
    if (!everSeen.has(r.state_key)) continue;
    day.statuses.push({
      status: legacyStatusOf(states, r.state_key),
      statusName: r.label_he,
      count: r.items,
      percentage: null,
      _new_stateKey: r.state_key,
      _new_series: "point_in_time",
    });
    day._new_activeTotal += r.items;
  }
  for (const r of finished.rows) {
    const day = days.at(r.business_day);
    day.finishedCumulative = r.finished_cumulative;
    day._new_finishedToday = r.finished_today;
  }
  for (const r of throughput.rows) {
    const day = days.at(r.business_day);
    day._new_workStartedToday = r.started;
    day._new_workFinishedToday = r.finished;
  }

  // A status filter that excludes `done` excludes the finished line too, or the
  // legend would contradict the filter.
  const showFinished = !filters.states || filters.states.includes("done");

  const data = days.sorted().map((day) => {
    for (const s of day.statuses) {
      s.percentage = day._new_activeTotal > 0 ? Math.round((s.count / day._new_activeTotal) * 1000) / 10 : 0;
    }
    if (showFinished) {
      day.statuses.push({
        status: legacyStatusOf(states, "done"),
        statusName: labelOf(states, "done"),
        count: day.finishedCumulative,
        percentage: null,
        _new_stateKey: "done",
        _new_series: "cumulative",
      } satisfies StatusHistoryEntryWire);
    }
    return day;
  });

  // Q2א honours the whole filter block; Q2ב and Q2ג cannot express station,
  // station type, worker or state — said per metric.
  return {
    body: data,
    filters,
    ignored: [
      ...qualify("finishedCumulative", finished.ignoredFilters),
      ...qualify("workThroughput", throughput.ignoredFilters),
    ],
  };
}, { historical: true });
