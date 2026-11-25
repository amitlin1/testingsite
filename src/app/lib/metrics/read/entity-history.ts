// The history of one customer, shipment or item type — the series behind three
// of the four history dialogs (the station has its own route): Q2א and Q2ב over
// one daily grid.
//
//   Q2א  the ACTIVE population at 12:00 Asia/Jerusalem on each civil day, one
//        count per metric_state — `unmapped` included (§3.1): an unknown state
//        is a real slice, never a dropped row. A day on which the entity had
//        nothing is a measured zero, not a hole and not the day before.
//   Q2ב  route_run closures, cumulative to that day, plus the day's own count.
//
// The two series are NOT summed: Q2א is a snapshot of what is in flight, Q2ב a
// running total of what has left. They are counts, so there is no clock pair.

import type { EntityHistoryWire } from "@/app/lib/dashboard/contract";
import type { StateKey } from "../vocabulary";
import { dayRows } from "./day-rows";
import type { FilterName, MetricFilters } from "./filters";
import type { ResolvedPeriod } from "./period";
import { finishedCumulative, pitSeries } from "./queries";
import type { MetricsClient } from "./sql";

/** A wire row with the cumulative closures under a neutral name — each route
 *  spells that field its own way. */
export type EntityHistoryRow = Omit<EntityHistoryWire, "finishedItems" | "itemsFinished"> & { finished: number };

/** metric_state.state_key → the wire field it is counted in. `done` never
 *  arrives (Q2א is the active population). */
const STATE_FIELD: Record<Exclude<StateKey, "done">, string> = {
  queued: "itemsInQueue",
  testing: "itemsInTest",
  queued_research: "itemsWaitingForResearch",
  in_research: "itemsInResearch",
  waiting_for_package_items: "_new_waiting_for_package_items",
  unmapped: "_new_unmapped",
};

export interface EntityHistoryResult {
  points: EntityHistoryRow[];
  /** Filters Q2ב cannot express, named rather than dropped (§5.0(1)). */
  ignoredFilters: FilterName[];
}

export async function entityHistory(
  client: MetricsClient,
  period: ResolvedPeriod,
  filters: MetricFilters,
): Promise<EntityHistoryResult> {
  const [series, finished] = await Promise.all([
    pitSeries(client, period.from, period.to, filters),
    finishedCumulative(client, period.from, period.to, filters),
  ]);

  // Q2א emits every active state on every grid day, so the loop below sets
  // `_new_waiting_for_package_items` on every row (after `finished`, as the
  // wire has always ordered it).
  const days = dayRows(
    (date) =>
      ({
        date,
        isToday: date === period.today,
        itemsInQueue: 0,
        itemsInTest: 0,
        itemsWaitingForResearch: 0,
        itemsInResearch: 0,
        _new_unmapped: 0,
        _new_activeTotal: 0,
        _new_finishedToday: 0,
        finished: 0,
      }) as EntityHistoryRow,
  );

  for (const r of series) {
    const row = days.at(r.business_day) as unknown as Record<string, number>;
    // A state the vocabulary does not know yet is surfaced under its own name,
    // never added into a neighbour (§3.1).
    row[STATE_FIELD[r.state_key as Exclude<StateKey, "done">] ?? `_new_${r.state_key}`] = r.items;
    row._new_activeTotal += r.items;
  }

  for (const r of finished.rows) {
    const row = days.at(r.business_day);
    row.finished = r.finished_cumulative;
    row._new_finishedToday = r.finished_today;
  }

  return { points: days.sorted(), ignoredFilters: finished.ignoredFilters };
}
