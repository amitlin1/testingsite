import type { HistoryTarget } from "@/app/components/dashboard/HistoryOverlay";
import type { DashboardData } from "@/app/lib/hooks/useDashboardData";
import type { DashboardStateApi } from "@/app/lib/hooks/useDashboardState";

/** Every tab gets the same three things: the shared state, the shared fetch
 *  results, and the one way to open the history overlay (§16.5). */
export interface TabProps {
  api: DashboardStateApi;
  data: DashboardData;
  openHistory: (target: HistoryTarget) => void;
}
