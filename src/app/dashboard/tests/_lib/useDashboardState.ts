"use client";

// §3 — ONE state object for the whole dashboard. The filters live above the
// tabs and survive a tab switch, so nothing here clears a filter on `tab`
// change. The state is projected onto the query string (state.ts); the rail's
// open/closed preference lives in localStorage.

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useLocalStorageFlag } from "@/lib/hooks/useLocalStorageFlag";
import { useReplaceQuery } from "@/lib/hooks/useUrlState";
import { EMPTY_FILTERS, countActiveFilters, type DashboardFilters } from "./filters";
import {
  RAIL_STORAGE_KEY,
  paramsFromState,
  stateFromParams,
  type AverageTimesPeriod,
  type DashboardState,
  type DateRangePreset,
  type StuckHours,
  type TabKey,
} from "./state";

export interface DashboardStateApi {
  state: DashboardState;
  setTab: (tab: TabKey) => void;
  setDatePreset: (preset: DateRangePreset) => void;
  setCustomRange: (start: string, end: string) => void;
  setFilter: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  setPeriod: (period: AverageTimesPeriod) => void;
  setStuckHours: (hours: StuckHours) => void;
  toggleRail: () => void;
  clearFilters: () => void;
  /** Jump to a tab and apply filters in one commit — the row-click drilldowns. */
  drillTo: (tab: TabKey, patch: Partial<DashboardFilters>, extra?: Partial<DashboardState>) => void;
  activeFilterCount: number;
}

export function useDashboardState(initial?: Partial<DashboardState>): DashboardStateApi {
  const replaceQuery = useReplaceQuery();
  const searchParams = useSearchParams();

  // The server render uses the default (open), so the server and the first
  // client paint agree; the rail's CSS width transition covers the correction.
  const [railOpen, setRailOpen] = useLocalStorageFlag(RAIL_STORAGE_KEY, { defaultValue: true });
  const [baseState, setState] = React.useState<DashboardState>(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    return { ...stateFromParams(sp, true), ...initial };
  });
  const state = React.useMemo(
    () => (baseState.railOpen === railOpen ? baseState : { ...baseState, railOpen }),
    [baseState, railOpen],
  );

  // Debounced because the text filters commit per character.
  const serialised = React.useMemo(() => paramsFromState(state).toString(), [state]);
  const lastPushed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastPushed.current === serialised) return;
    const timer = setTimeout(() => {
      lastPushed.current = serialised;
      replaceQuery(serialised);
    }, 300);
    return () => clearTimeout(timer);
  }, [serialised, replaceQuery]);

  const patch = React.useCallback((updater: (s: DashboardState) => DashboardState) => {
    setState((s) => updater(s));
  }, []);

  const api: DashboardStateApi = {
    state,
    setTab: React.useCallback((tab) => patch((s) => ({ ...s, tab })), [patch]),
    setDatePreset: React.useCallback(
      (datePreset) =>
        // A shipment is scoped to its own dates, so changing the range drops it
        // rather than showing an empty table.
        patch((s) => ({ ...s, datePreset, filters: { ...s.filters, shipmentId: null } })),
      [patch],
    ),
    setCustomRange: React.useCallback(
      (customStart, customEnd) => patch((s) => ({ ...s, customStart, customEnd, datePreset: "custom" })),
      [patch],
    ),
    setFilter: React.useCallback(
      (key, value) => patch((s) => ({ ...s, filters: { ...s.filters, [key]: value } })),
      [patch],
    ),
    setPeriod: React.useCallback((period) => patch((s) => ({ ...s, period })), [patch]),
    setStuckHours: React.useCallback((stuckHours) => patch((s) => ({ ...s, stuckHours })), [patch]),
    toggleRail: React.useCallback(() => setRailOpen((open) => !open), [setRailOpen]),
    // §6: `נקה הכל` resets everything except the date range.
    clearFilters: React.useCallback(
      () => patch((s) => ({ ...s, filters: { ...EMPTY_FILTERS } })),
      [patch],
    ),
    drillTo: React.useCallback(
      (tab, filterPatch, extra) =>
        patch((s) => ({ ...s, ...extra, tab, filters: { ...s.filters, ...filterPatch } })),
      [patch],
    ),
    activeFilterCount: countActiveFilters(state.filters),
  };

  return api;
}
