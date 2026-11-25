// The state distribution: Q1 (§5.2), the ACTIVE population at the end of the
// selected window — for a window that includes today, the live floor.
//
// `done` IS NOT A SLICE (§5.2): a terminal interval stays open forever, so
// counting it makes the chart a grey 99.6% circle after eighteen months and
// scans all of history. The cumulative finished count is its own metric, from
// route_run closures, served by the /history sibling.
//
// Labels are metric_state.label_he; `status` is the legacy numeric id the
// chart colours by, read from metric_state.legacy_status_id.

import { prisma } from "@/lib/db";
import type { StatusWire } from "@/app/lib/dashboard/contract";
import { legacyStatusOf, metricStates } from "@/app/lib/metrics/read/metric-state";
import { pointInTime } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch status distribution", async ({ period, filters }) => {
  // The last instant of the window: toTsExclusive is the following midnight.
  const asOf = new Date(period.toTsExclusive.getTime() - 1);

  const [rows, states] = await Promise.all([pointInTime(prisma, asOf, filters), metricStates(prisma)]);

  const asOfIso = asOf.toISOString();
  const distribution = rows.map(
    (r) =>
      ({
        status: legacyStatusOf(states, r.state_key),
        statusName: r.label_he,
        count: r.items,
        // Q1's own window function, over the population it counted.
        percentage: r.pct ?? 0,
        _new_stateKey: r.state_key,
        _new_units: r.units,
        _new_asOf: asOfIso,
      }) satisfies StatusWire,
  );

  return { body: distribution, filters };
});
