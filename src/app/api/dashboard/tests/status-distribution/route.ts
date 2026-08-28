// Q1 — §5.2 point-in-time state distribution over the ACTIVE population.
//
// Replaces MetricsService.getStatusDistributionFiltered (left in place for the
// parity harness until stage 7), whose result was a hybrid: partly live
// item_routes.current_status, partly a window aggregate.
//
// WHY `done` IS NOT A SLICE (§5.2). A terminal interval stays open forever, so
// counting it through `@>` makes the chart a grey 99.6% "completed" circle
// after eighteen months — and scans all of history, because the GiST index is
// partial on NOT is_terminal. The cumulative finished count is a separate
// metric with a separate name, from route_run closures (§5.3ב): it is served by
// this endpoint's /history sibling as `finishedCumulative`.
//
// THE INSTANT PROBED is the end of the requested window, which for any window
// that includes today degenerates to now() (an open interval contains every
// future instant). So the date picker finally means something on this screen —
// "what did the floor look like at the end of last Tuesday" is answerable —
// while the default "today" view is still the live board.
//
// §9.4: count and percentage move (genuinely point-in-time, active population),
// and the labels now come from metric_state.label_he rather than the hardcoded
// status-names.ts map. The `status` field stays the legacy numeric id because
// the chart colours by it; metric_state.legacy_status_id is the mapping, read
// from the table rather than retyped (see dashboard-request.ts).

import { withAuth } from "@/lib/auth/withAuth";
import { NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { pointInTime } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  legacyStatusOf,
  metricStates,
  metricsJson,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";
import type { StatusDistribution } from "@/types/dashboard";

export const runtime = "nodejs";

interface StatusDistributionResponse extends StatusDistribution {
  /** The ledger's own vocabulary (§3.1); stage 6 keys off this instead. */
  _new_stateKey: string;
  /** §5.0(6): unit_id de-duplication is legal here — the grouping key is the
   *  state, and a unit is in one state at a time. */
  _new_units: number;
  /** The instant the distribution was probed at, so a screenshot can be dated. */
  _new_asOf: string;
}

export const GET = withAuth(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  try {
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);

    // End of the selected window, inclusive. `toTsExclusive` is the following
    // midnight in Asia/Jerusalem (§7.2).
    const asOf = new Date(period.toTsExclusive.getTime() - 1);

    const [rows, states] = await Promise.all([
      pointInTime(prisma, asOf, filters),
      metricStates(prisma),
    ]);

    const asOfIso = asOf.toISOString();
    const distribution: StatusDistributionResponse[] = rows.map((r) => ({
      status: legacyStatusOf(states, r.state_key),
      statusName: r.label_he,
      count: r.items,
      // Q1 computes the share as a window function in SQL, over the same
      // filtered population it counted — never a second query's total.
      percentage: r.pct ?? 0,
      _new_stateKey: r.state_key,
      _new_units: r.units,
      _new_asOf: asOfIso,
    }));

    return metricsJson(distribution, period, filters);
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching status distribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch status distribution" },
      { status: 500 }
    );
  }
}, { role: "manager" });
