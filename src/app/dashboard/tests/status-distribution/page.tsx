import { redirectToTab, type OldRouteSearchParams } from "../redirect-to-tab";
import { DEFAULT_TAB } from "../_lib/state";

// The התפלגות סטטוסים tab is hidden (2026-11-26), so its old address opens the
// board's main tab; with the tab back, this redirects to "status" again.
export default async function Page({ searchParams }: { searchParams: OldRouteSearchParams }) {
  return redirectToTab(DEFAULT_TAB, searchParams);
}
