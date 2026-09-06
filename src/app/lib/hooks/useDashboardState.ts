"use client";

// §3 — ONE state object for the whole dashboard.
//
// The eight old pages each re-declared `DashboardFilters` and reset it on
// navigation. Here the filters live above the tabs and survive a tab switch;
// that is the single biggest behavioural win of the rebuild, so nothing in this
// file clears a filter on `tab` change.
//
// The state is serialised to the query string so `?tab=slow&customerId=4821`
// deep-links into a view, and `railOpen` lives in localStorage under exactly one
// key (§3).

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type {
  AverageTimesPeriod,
  DashboardFilters,
  DateRangePreset,
  StatusFilter,
} from "@/types/dashboard";

export type TabKey =
  | "overview"
  | "kpis"
  | "stations"
  | "slow"
  | "shipments"
  | "times"
  | "status"
  | "customers"
  | "types";

export const TAB_KEYS: readonly TabKey[] = [
  "overview",
  "kpis",
  "stations",
  "slow",
  "shipments",
  "times",
  "status",
  "customers",
  "types",
];

export type StuckHours = 24 | 48 | 72 | null;

export interface DashboardState {
  tab: TabKey;
  datePreset: DateRangePreset;
  customStart: string;
  customEnd: string;
  filters: DashboardFilters;
  period: AverageTimesPeriod;
  stuckHours: StuckHours;
  railOpen: boolean;
}

export const RAIL_STORAGE_KEY = "sh.dashboard.railOpen";

export const EMPTY_FILTERS: DashboardFilters = {
  customerId: null,
  shipmentId: null,
  itemSerial: null,
  itemId: null,
  itemTypeId: null,
  testStationId: null,
  testStationTypeId: null,
  workerId: null,
  status: "all",
  showAllHistory: false,
};

function readTab(raw: string | null): TabKey {
  return TAB_KEYS.includes(raw as TabKey) ? (raw as TabKey) : "overview";
}

function readInt(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function readText(raw: string | null): string | null {
  const s = raw?.trim();
  return s ? s : null;
}

function readPreset(raw: string | null): DateRangePreset {
  return raw === "last7days" || raw === "last30days" || raw === "custom" || raw === "today"
    ? raw
    : "today";
}

function readPeriod(raw: string | null): AverageTimesPeriod {
  return raw === "monthly" || raw === "quarterly" ? raw : "daily";
}

function readStuck(raw: string | null): StuckHours {
  if (raw === "all") return null;
  const n = Number.parseInt(raw ?? "", 10);
  return n === 24 || n === 48 || n === 72 ? n : 48;
}

function stateFromParams(sp: URLSearchParams, railOpen: boolean): DashboardState {
  return {
    tab: readTab(sp.get("tab")),
    datePreset: readPreset(sp.get("range")),
    customStart: sp.get("start") ?? "",
    customEnd: sp.get("end") ?? "",
    filters: {
      customerId: readInt(sp.get("customerId")),
      shipmentId: readInt(sp.get("shipmentId")),
      itemSerial: readText(sp.get("itemSerial")),
      itemId: readInt(sp.get("itemId")),
      itemTypeId: readInt(sp.get("itemTypeId")),
      testStationId: readInt(sp.get("testStationId")),
      testStationTypeId: readInt(sp.get("testStationTypeId")),
      workerId: readText(sp.get("workerId")),
      status: (["all", "queue", "processing", "finished"] as const).includes(
        sp.get("status") as StatusFilter,
      )
        ? (sp.get("status") as StatusFilter)
        : "all",
      showAllHistory: sp.get("showAllHistory") === "true",
    },
    period: readPeriod(sp.get("period")),
    stuckHours: readStuck(sp.get("stuck")),
    railOpen,
  };
}

/** Only non-default values reach the URL, so a shared link stays readable. */
function paramsFromState(s: DashboardState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.tab !== "overview") p.set("tab", s.tab);
  if (s.datePreset !== "today") p.set("range", s.datePreset);
  if (s.datePreset === "custom") {
    if (s.customStart) p.set("start", s.customStart);
    if (s.customEnd) p.set("end", s.customEnd);
  }
  const f = s.filters;
  if (f.customerId != null) p.set("customerId", String(f.customerId));
  if (f.shipmentId != null) p.set("shipmentId", String(f.shipmentId));
  if (f.itemSerial) p.set("itemSerial", f.itemSerial);
  if (f.itemId != null) p.set("itemId", String(f.itemId));
  if (f.itemTypeId != null) p.set("itemTypeId", String(f.itemTypeId));
  if (f.testStationId != null) p.set("testStationId", String(f.testStationId));
  if (f.testStationTypeId != null) p.set("testStationTypeId", String(f.testStationTypeId));
  if (f.workerId) p.set("workerId", f.workerId);
  if (f.status !== "all") p.set("status", f.status);
  if (f.showAllHistory) p.set("showAllHistory", "true");
  if (s.period !== "daily") p.set("period", s.period);
  if (s.stuckHours === null) p.set("stuck", "all");
  else if (s.stuckHours !== 48) p.set("stuck", String(s.stuckHours));
  return p;
}

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [railOpen, setRailOpen] = React.useState(true);
  const [state, setState] = React.useState<DashboardState>(() => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    return { ...stateFromParams(sp, true), ...initial };
  });

  // localStorage is read after mount so the server and the first client paint
  // agree; the rail's own CSS width transition covers the correction.
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(RAIL_STORAGE_KEY);
      if (stored !== null) setRailOpen(stored === "true");
    } catch {
      /* private mode — keep the default */
    }
  }, []);

  React.useEffect(() => {
    setState((s) => (s.railOpen === railOpen ? s : { ...s, railOpen }));
  }, [railOpen]);

  // The URL is a projection of the state, written back with `replace` so the
  // browser's back button still leaves the dashboard rather than walking every
  // filter keystroke. Debounced because the text filters commit per character.
  const serialised = React.useMemo(() => paramsFromState(state).toString(), [state]);
  const lastPushed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (lastPushed.current === serialised) return;
    const timer = setTimeout(() => {
      lastPushed.current = serialised;
      router.replace(serialised ? `${pathname}?${serialised}` : pathname, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [serialised, pathname, router]);

  const patch = React.useCallback((updater: (s: DashboardState) => DashboardState) => {
    setState((s) => updater(s));
  }, []);

  const api: DashboardStateApi = {
    state,
    // NOTHING is reset here. Filters crossing a tab boundary is the point (§3).
    setTab: React.useCallback((tab) => patch((s) => ({ ...s, tab })), [patch]),
    setDatePreset: React.useCallback(
      (datePreset) =>
        // Existing behaviour, kept: a shipment is scoped to its own dates, so
        // changing the range drops it rather than showing an empty table.
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
    toggleRail: React.useCallback(() => {
      setRailOpen((open) => {
        const next = !open;
        try {
          localStorage.setItem(RAIL_STORAGE_KEY, String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }, []),
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

export function countActiveFilters(f: DashboardFilters): number {
  let n = 0;
  if (f.customerId != null) n++;
  if (f.shipmentId != null) n++;
  if (f.itemSerial) n++;
  if (f.itemId != null) n++;
  if (f.itemTypeId != null) n++;
  if (f.testStationId != null) n++;
  if (f.testStationTypeId != null) n++;
  if (f.workerId) n++;
  if (f.status !== "all") n++;
  if (f.showAllHistory) n++;
  return n;
}
