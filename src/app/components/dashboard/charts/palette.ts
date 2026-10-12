// ONE colour per state, for every chart and every legend on the dashboard
// (§9 / §10). Before this map `--dash-ramp-4` meant three different things —
// the queue on the station board, "waiting for package items" in the donut and
// "work started" in the throughput bars — and the donut painted the queue in a
// different blue from the board beside it. A state now looks the same wherever
// it is drawn; a series that is not a state (throughput) takes a ramp step no
// state uses.
//
// The ramp itself lives in dashboard.css (`--dash-ramp-*`): the strongest step
// is the action blue, the weakest a neutral that clears 3:1 on white.

/** state_key → colour. Shared by the donut, the status trend, the history
 *  bands, the station load bar and their legends. */
export const STATE_COLOR: Record<string, string> = {
  testing: "var(--dash-ramp-1)",
  waiting_for_package_items: "var(--dash-ramp-2)",
  queued_research: "var(--dash-ramp-3)",
  queued: "var(--dash-ramp-4)",
  in_research: "var(--dash-ramp-5)",
  // An unknown status keeps its own colour so it is never folded into a
  // neighbour — the light-surface amber, not the one made for the dark strip.
  unmapped: "var(--dash-amber-chart)",
};

export function stateColor(stateKey: string, index: number): string {
  return STATE_COLOR[stateKey] ?? `var(--dash-ramp-${Math.min(5, index + 1)})`;
}

/** The throughput pair (§8.2) is two series, not two states. */
export const SERIES_COLOR = {
  started: "var(--dash-ramp-3)",
  finished: "var(--dash-ramp-1)",
} as const;

/** The 1px line between touching segments (donut slices, stacked bars and
 *  bands), so neighbouring ramp steps never merge into one shape. */
export const SEGMENT_SEPARATOR = "var(--color-canvas)";
