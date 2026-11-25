// The completion curve (§5.10 `completion_history_percentage`): per shipment,
// per sampled business day, closed route_runs over opened route_runs, both
// cumulative to that day. The denominator is the routed population of THAT day,
// never shipments.amount (§5.8); a day before anything was routed has no point
// at all rather than a fabricated 0% (§5.0(7)). Derivation:
// src/app/lib/metrics/read/completion-series.ts.
//
// Historical (§5.0(1)): a shipment despatched inside the window is exactly what
// a history chart must keep.
//
// GRAIN: `granularity` when given; otherwise daily up to 45 days and monthly
// beyond (a monthly grain over 30 days is one point, not a history). The sums
// run over every day either way; only the reporting is sparse.
//
// THE BODY'S KEYS ARE THE SERIES: every key other than `date` and the
// `_new_`-prefixed metadata is a shipment code. So the period, the grain and the
// ignored filters travel as headers — a body field would draw a phantom line.
// `_new_counts` holds the two numbers behind each ratio, because completion
// drops whenever a run is routed, and without the denominator a reader sees a
// regression where there was an arrival.

import { prisma } from "@/lib/db";
import type { CompletionHistoryWire } from "@/app/lib/dashboard/contract";
import { completionSeries, sampleDays } from "@/app/lib/metrics/read/completion-series";
import { qualify, unhonoured } from "@/app/lib/metrics/read/filters";
import { isGranularity } from "@/app/lib/metrics/read/period";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Internal Server Error", async ({ period: resolved, filters, searchParams }) => {
  const explicit = searchParams.get("granularity");
  // The grain suits the CAPPED window, and the header reports the grain served.
  const granularity = isGranularity(explicit) ? explicit : resolved.days <= 45 ? "daily" : "monthly";
  const period = { ...resolved, granularity };

  const days = sampleDays(period.from, period.to, granularity);
  const rows = await completionSeries(prisma, period.from, period.to, days, filters);

  const byDate = new Map<string, CompletionHistoryWire>();
  for (const d of days) byDate.set(d, { date: d, _new_counts: {} });
  for (const r of rows) {
    if (r.completion_pct === null) continue;
    const point = byDate.get(r.business_day);
    if (!point) continue;
    // The chart is keyed by code; two shipments sharing one must not overwrite each other.
    const key = r.shipment_code || `#${r.shipment_id}`;
    const label = point[key] === undefined ? key : `${key} (#${r.shipment_id})`;
    point[label] = r.completion_pct.toFixed(1);
    point._new_counts[label] = { routed: r.routed_runs, finished: r.finished_runs };
  }

  // A day with no shipment on it (only `date` and `_new_counts`) is dropped:
  // the chart draws a gap either way.
  const points = days.map((d) => byDate.get(d)!).filter((o) => Object.keys(o).length > 2);

  return { body: points, filters, period, ignored: qualify("completionSeries", unhonoured("runs", filters)) };
}, { historical: true });
