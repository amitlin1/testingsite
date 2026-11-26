import { redirectToTab, type OldRouteSearchParams } from "../redirect-to-tab";
import { DEFAULT_TAB } from "../_lib/state";

// The מדדים tab is hidden (2026-11-26), so its old address opens the board's
// default tab; with the tab back, this redirects to "kpis" again.
export default async function Page({ searchParams }: { searchParams: OldRouteSearchParams }) {
  return redirectToTab(DEFAULT_TAB, searchParams);
}
