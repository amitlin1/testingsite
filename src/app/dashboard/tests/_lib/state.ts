// §3 — the dashboard's one state object and its projection onto the URL, so
// `?tab=slow&customerId=4821` deep-links into a view. Pure: the hook that owns it
// is useDashboardState.

import { filtersFromParams, writeFilterParams, type DashboardFilters } from "./filters";
import { STUCK_HOURS } from "./format";

export const DATE_RANGE_PRESETS = ["today", "last7days", "last30days", "custom"] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/** The bucket width of the average-times chart (the `period` query param). */
export const AVERAGE_TIMES_PERIODS = ["daily", "monthly", "quarterly"] as const;
export type AverageTimesPeriod = (typeof AVERAGE_TIMES_PERIODS)[number];

// In rail order (the rail's first entry is a link to the main page,
// /dashboard, not a tab). Two tabs are commented out on request (2026-11-26)
// so they cannot be reached — their files are kept as they are:
//   מדדים (kpis, tabs/KpisTab.tsx) — the main page took its place;
//   התפלגות סטטוסים (status, tabs/StatusTab.tsx).
// To bring one back, uncomment it here and the lines marked "kpis tab" /
// "status tab" in DashboardSidebar.tsx, DashboardShell.tsx and
// useDashboardData.ts.
export const TAB_KEYS = [
  // "kpis",
  "overview",
  "stations",
  "slow",
  "shipments",
  "times",
  // "status",
  "customers",
  "types",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

/** The tab an empty URL opens — and the one that is never written to it. */
export const DEFAULT_TAB: TabKey = "overview";

export const STUCK_HOURS_OPTIONS = [24, 48, 72] as const;
/** The slow-items threshold; null shows every row. */
export type StuckHours = (typeof STUCK_HOURS_OPTIONS)[number] | null;

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

/** The one localStorage key the rail's open/closed preference lives under (§3). */
export const RAIL_STORAGE_KEY = "sh.dashboard.railOpen";

function oneOf<T extends string>(list: readonly T[], raw: string | null, fallback: T): T {
  return list.includes(raw as T) ? (raw as T) : fallback;
}

function readStuck(raw: string | null): StuckHours {
  if (raw === "all") return null;
  const n = Number.parseInt(raw ?? "", 10);
  return STUCK_HOURS_OPTIONS.find((hours) => hours === n) ?? STUCK_HOURS;
}

export function stateFromParams(sp: URLSearchParams, railOpen: boolean): DashboardState {
  return {
    tab: oneOf(TAB_KEYS, sp.get("tab"), DEFAULT_TAB),
    datePreset: oneOf(DATE_RANGE_PRESETS, sp.get("range"), "today"),
    customStart: sp.get("start") ?? "",
    customEnd: sp.get("end") ?? "",
    filters: filtersFromParams(sp),
    period: oneOf(AVERAGE_TIMES_PERIODS, sp.get("period"), "daily"),
    stuckHours: readStuck(sp.get("stuck")),
    railOpen,
  };
}

/** Only non-default values reach the URL, so a shared link stays readable. */
export function paramsFromState(s: DashboardState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.tab !== DEFAULT_TAB) p.set("tab", s.tab);
  if (s.datePreset !== "today") p.set("range", s.datePreset);
  if (s.datePreset === "custom") {
    if (s.customStart) p.set("start", s.customStart);
    if (s.customEnd) p.set("end", s.customEnd);
  }
  writeFilterParams(s.filters, p);
  if (s.period !== "daily") p.set("period", s.period);
  if (s.stuckHours === null) p.set("stuck", "all");
  else if (s.stuckHours !== STUCK_HOURS) p.set("stuck", String(s.stuckHours));
  return p;
}
