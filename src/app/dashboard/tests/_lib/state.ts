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

export const TAB_KEYS = [
  "overview",
  "kpis",
  "stations",
  "slow",
  "shipments",
  "times",
  "status",
  "customers",
  "types",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

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
    tab: oneOf(TAB_KEYS, sp.get("tab"), "overview"),
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
  if (s.tab !== "overview") p.set("tab", s.tab);
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
