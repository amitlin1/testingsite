import type { HistoryTarget } from "../_components/HistoryOverlay";
import type { DashboardData } from "../_lib/useDashboardData";
import type { DashboardStateApi } from "../_lib/useDashboardState";

/** Every tab gets the same three things: the shared state, the shared fetch
 *  results, and the one way to open the history overlay (§16.5). */
export interface TabProps {
  api: DashboardStateApi;
  data: DashboardData;
  openHistory: (target: HistoryTarget) => void;
}
