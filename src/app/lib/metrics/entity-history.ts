// The three entity history DIALOGS — customer, shipment, item type — are one
// series with three filters (§8 stage 6: "customers/[id]/history -> Q2 (customer
// filter)", and the same line for shipment and item type). This composes Q2א and
// Q2ב for them so the composition is written ONCE; it contains no SQL of its
// own, exactly like completion-series.ts contains the one composite §5.10 names
// but §5.2..§5.9 do not spell out.
//
// WHAT THE OLD ROUTES RETURNED
// ----------------------------
// A read of `{customer,shipment,item_type}_snapshots[_monthly]` — tables written
// by a date-less function that stored NOW() under a past date, and which hold 0
// rows on this database — followed by a live COUNT over `item_routes.current_status`
// stapled on as "today". Three consequences, all of them visible in a real call:
//
//   1. The series was a single point. Every dialog showed one dot labelled היום
//      and called it history.
//   2. When a snapshot for today DID exist, the route MERGED the live point over
//      it (`results[last] = {...results[last], ...todayPoint}`), so any field the
//      live query did not compute kept the snapshot's stale value. That is the
//      carry-forward §5.0(7) forbids, done inside a single row.
//   3. "finished" was `count(current_status = 3)` — a sample of the terminal
//      state. §5.3ב: finished is a `route_run` closure and nothing else.
//
// WHAT THIS RETURNS
// -----------------
// Two series over one daily grid, from the ledger:
//
//   Q2א  the ACTIVE population at 12:00 Asia/Jerusalem on each civil day, one
//        count per metric_state — including `unmapped` (§3.1), which is a real
//        slice and not a row to drop. A day on which the entity had nothing is a
//        measured zero, not a hole and not last week's number carried forward.
//   Q2ב  `finished*`: route_run closures, cumulative to that day, plus the
//        additive per-day count as `_new_finishedToday`.
//
// The two series answer different questions and are NOT summed: Q2א is a
// snapshot of what is in flight, Q2ב is a running total of what has left. The
// old `totalItems` / `itemsInRoutes` / `successPercentage` / `completionPercentage`
// columns are gone rather than reconstructed — every one of them was a
// present-day scalar (or a stored ratio, §2.7) that the old chart painted
// backwards across the whole history. None was ever rendered; the dialogs draw
// the five state lines and nothing else.
//
// THERE IS NO CLOCK PAIR HERE, and that is not an omission: §2.8 pairs
// DURATIONS. These are counts. The one dialog of the four that does show a
// duration is the station dialog, and it carries both clocks — see
// src/app/api/dashboard/stations/[id]/history/route.ts.

import type { MetricFilters } from "./filters";
import type { ResolvedPeriod } from "./period";
import { finishedCumulative, pitSeries, type MetricsClient } from "./queries";

/** The key the dialog's chart reads its "finished" line from. The two spellings
 *  are the ones the existing components already bind to; keeping each one is
 *  what makes this a data change and not a rewrite. */
export type FinishedKey = "finishedItems" | "itemsFinished";

export interface EntityHistoryPoint {
  date: string;
  /** True on the window's last day when that day is today (Asia/Jerusalem). The
   *  dialogs label it היום and hold it out of the weekly aggregation. */
  isToday: boolean;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  /** §3.1 — an item whose `item_status` has no `metric_state` row. Always
   *  present, so it is visible the day it stops being zero. */
  _new_unmapped: number;
  /** Sum of the active states at this point. */
  _new_activeTotal: number;
  /** route_run closures on this day alone — additive, unlike the cumulative. */
  _new_finishedToday: number;
  /** finishedItems | itemsFinished — Q2ב, cumulative closures (§5.3ב). */
  [finished: string]: number | string | boolean;
}

/** metric_state.state_key -> the wire key the dialogs already chart. */
const STATE_TO_KEY: Record<string, keyof EntityHistoryPoint & string> = {
  queued: "itemsInQueue",
  testing: "itemsInTest",
  queued_research: "itemsWaitingForResearch",
  in_research: "itemsInResearch",
  unmapped: "_new_unmapped",
};

export interface EntityHistoryResult {
  points: EntityHistoryPoint[];
  /** Filters Q2ב cannot express (station / station type / worker / state) —
   *  named, never dropped in silence (§5.0(1)). */
  ignoredFilters: string[];
}

export async function entityHistory(
  client: MetricsClient,
  period: ResolvedPeriod,
  filters: MetricFilters,
  finishedKey: FinishedKey
): Promise<EntityHistoryResult> {
  const [series, finished] = await Promise.all([
    pitSeries(client, period.from, period.to, filters),
    finishedCumulative(client, period.from, period.to, filters),
  ]);

  const byDay = new Map<string, EntityHistoryPoint>();
  const dayOf = (d: string): EntityHistoryPoint => {
    let p = byDay.get(d);
    if (!p) {
      byDay.set(
        d,
        (p = {
          date: d,
          isToday: d === period.today,
          itemsInQueue: 0,
          itemsInTest: 0,
          itemsWaitingForResearch: 0,
          itemsInResearch: 0,
          _new_unmapped: 0,
          _new_activeTotal: 0,
          _new_finishedToday: 0,
          [finishedKey]: 0,
        })
      );
    }
    return p;
  };

  for (const r of series) {
    const p = dayOf(r.business_day);
    const key = STATE_TO_KEY[r.state_key];
    // A state_key that metric_state grows and this map does not know is
    // surfaced under its own name rather than added into a neighbour — the
    // whole point of `unmapped` is that an unknown must stay visible (§3.1).
    p[key ?? `_new_${r.state_key}`] = r.items;
    p._new_activeTotal += r.items;
  }

  for (const r of finished.rows) {
    const p = dayOf(r.business_day);
    p[finishedKey] = r.finished_cumulative;
    p._new_finishedToday = r.finished_today;
  }

  return {
    points: [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    ignoredFilters: finished.ignoredFilters,
  };
}
