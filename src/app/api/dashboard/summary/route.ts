// The managers' summary screen: what happened in the window, and the open
// shipments as they stand now. Definitions: lib/metrics/read/summary.ts.
//
// No filter applies here — the screen has none — so none is read into the
// queries, and any that arrive are reported as ignored rather than dropped
// in silence (§5.0(1)).
//
// `historical`: the window counts everything that happened in it, shipped or
// not (scope `all`), unlike the KPI card's open-shipments default. The `now`
// half is the open shipments by definition, whatever the scope says.

import { prisma } from "@/lib/db";
import type { SummaryWire } from "@/app/lib/dashboard/contract";
import { summaryNow, summaryPeriod } from "@/app/lib/metrics/read/summary";
import { metricsRoute } from "../_lib/metrics-route";

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((1000 * part) / whole) / 10;

export const GET = metricsRoute("window", "Failed to fetch the dashboard summary", async ({ period, filters }) => {
  const asOf = new Date();
  const [p, n] = await Promise.all([summaryPeriod(prisma, period.from, period.to), summaryNow(prisma)]);

  const judged = p.items_passed + p.items_failed;
  const body = {
    period: {
      shipmentsIn: p.shipments_in,
      shipmentsOut: p.shipments_out,
      boxesIn: p.boxes_in,
      boxesOut: p.boxes_out,
      itemsPassed: p.items_passed,
      itemsFailed: p.items_failed,
      itemsUndecided: p.items_undecided,
      passPct: pct(p.items_passed, judged),
      failPct: pct(p.items_failed, judged),
      boxesFinished: p.boxes_finished,
      boxesTimed: p.boxes_timed,
      routeTime: { wall: p.route_wall_s, work: p.route_work_s },
    },
    now: {
      asOf: asOf.toISOString(),
      shipmentsInWork: n.shipments_open - n.shipments_ready,
      shipmentsReady: n.shipments_ready,
      itemsTotal: n.items_total,
      itemsWaiting: n.items_waiting,
      itemsInWork: n.items_in_work,
      itemsInResearch: n.items_in_research,
      itemsReady: n.items_ready,
    },
  } satisfies SummaryWire;

  const ignored = Object.entries(filters)
    .filter(([key, value]) => key !== "scope" && value !== undefined && value !== null && value !== false)
    .map(([key]) => `summary:${key}`);

  return { body, filters, ignored };
}, { historical: true });
