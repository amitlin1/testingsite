// ONE colour per state, for every chart and every legend on the dashboard
// (§9 / §10): a state looks the same wherever it is drawn, and a series that is
// not a state (throughput) takes a colour no state uses.
//
// Since 2026-11-26 each state has its OWN HUE (dashboard.css `--dash-state-*`)
// instead of a step on one blue ramp — five shades of blue could not be told
// apart at a glance.

import type { StateKey } from "@/app/lib/metrics/vocabulary";

/** state_key → colour. Shared by the donut, the status trend, the history
 *  bands, the station load bar and their legends. `done` is terminal and never
 *  drawn (every chart shows the active population), so it has no colour. */
export const STATE_COLOR: Record<Exclude<StateKey, "done">, string> = {
  testing: "var(--dash-state-testing)",
  waiting_for_package_items: "var(--dash-state-waiting-items)",
  queued_research: "var(--dash-state-queued-research)",
  queued: "var(--dash-state-queued)",
  in_research: "var(--dash-state-in-research)",
  // An unknown status keeps its own (neutral) colour so it is never folded
  // into a neighbour.
  unmapped: "var(--dash-state-unmapped)",
};

/** The wire carries state keys as strings; a key outside the map is drawn as unknown. */
export function stateColor(stateKey: string): string {
  return (STATE_COLOR as Record<string, string | undefined>)[stateKey] ?? STATE_COLOR.unmapped;
}

/** The throughput pair (§8.2) is two series, not two states. */
export const SERIES_COLOR = {
  started: "var(--dash-state-testing)",
  finished: "var(--dash-series-finished)",
} as const;

/**
 * The duration charts (זמנים ממוצעים, the station dialog): the family is the
 * hue — waiting = the queue's amber, processing = the testing blue — and the
 * clock is the shade (bars) or the dash (lines): ברוטו full, נטו lighter/dashed.
 */
export const DURATION_COLOR = {
  wait: "var(--dash-state-queued)",
  waitNet: "var(--dash-wait-net)",
  processing: "var(--dash-state-testing)",
  processingNet: "var(--dash-processing-net)",
} as const;

/** The 1px line between touching segments (donut slices, stacked bars and
 *  bands), so neighbouring colours never merge into one shape. */
export const SEGMENT_SEPARATOR = "var(--color-canvas)";
