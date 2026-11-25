// The dashboard's request windows and query strings.
//
// A window is a pair of civil dates (YYYY-MM-DD) from the browser's own
// calendar, sent as such: the server reads them as business days in
// Asia/Jerusalem (§7.2), so for a browser in Israel the two agree. A time of day
// would mean nothing to the server and is never sent.

import { HISTORY_PRESET_MONTHS, type HistoryPreset } from "@/app/lib/dashboard/contract";
import { addDays, dayCountInclusive, localCivilDate, type CivilDate } from "@/lib/time/civil";
import { appendRequestFilters, type DashboardFilters } from "./filters";
import type { DateRangePreset } from "./state";

/** Both ends inclusive. Two empty strings while a custom range is half picked. */
export interface DateRange {
  startDate: CivilDate;
  endDate: CivilDate;
}

export function getDateRange(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): DateRange {
  if (preset === "custom") {
    if (!customStart || !customEnd) return { startDate: "", endDate: "" };
    return { startDate: customStart, endDate: customEnd };
  }
  const today = localCivilDate(now);
  if (preset === "last7days") return { startDate: addDays(today, -6), endDate: today };
  if (preset === "last30days") return { startDate: addDays(today, -29), endDate: today };
  return { startDate: today, endDate: today };
}

/** The comparison window of every trend on the board: the same number of days,
 *  immediately before. */
export function previousRange({ startDate, endDate }: DateRange): DateRange {
  const days = dayCountInclusive(startDate, endDate);
  return { startDate: addDays(startDate, -days), endDate: addDays(endDate, -days) };
}

/** A fixed lookback of `days` days ending on the selected window's last day (`· 14 ימים`). */
export function rangeEndingAt(endDate: CivilDate, days: number): DateRange {
  return { startDate: addDays(endDate, -(days - 1)), endDate };
}

/**
 * The shipment dialog's completion-curve window: the preset's months back from
 * today, by the browser's calendar. It starts one day before the window the
 * history endpoints serve for the same preset (they start the day after) — a
 * known difference, kept as it is.
 */
export function completionCurveRange(preset: HistoryPreset, now: Date = new Date()): DateRange {
  const start = new Date(now);
  start.setMonth(start.getMonth() - HISTORY_PRESET_MONTHS[preset]);
  return { startDate: localCivilDate(start), endDate: localCivilDate(now) };
}

/** The filters as query params, plus the window unless `range` is null. */
export function buildDashboardQueryParams(filters: DashboardFilters, range: DateRange | null): URLSearchParams {
  const params = new URLSearchParams();
  if (range) {
    params.append("startDate", range.startDate);
    params.append("endDate", range.endDate);
  }
  appendRequestFilters(filters, params);
  return params;
}
