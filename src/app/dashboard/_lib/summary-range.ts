// The summary screen's windows and number shapes. Pure, so the tests and the
// server agree on what "השבוע" means without a browser.
//
// The presets are CALENDAR periods ending today — the week from Sunday, the
// month from the 1st, the quarter from its first day — not rolling 7/30-day
// windows: a manager asking "how was this month" means the month.

import { addDays, weekdayOf, type CivilDate } from "@/lib/time/civil";

export const SUMMARY_PRESETS = ["today", "week", "month", "quarter", "custom"] as const;
export type SummaryPreset = (typeof SUMMARY_PRESETS)[number];

export const SUMMARY_PRESET_LABEL: Record<SummaryPreset, string> = {
  today: "היום",
  week: "השבוע",
  month: "החודש",
  quarter: "הרבעון",
  custom: "טווח תאריכים",
};

export interface CivilRange {
  from: CivilDate;
  to: CivilDate;
}

/** The window of a preset on `today`'s calendar; null for a custom range not yet picked. */
export function presetRange(preset: SummaryPreset, today: CivilDate, custom?: Partial<CivilRange>): CivilRange | null {
  if (preset === "custom") {
    return custom?.from && custom?.to && custom.from <= custom.to ? { from: custom.from, to: custom.to } : null;
  }
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") return { from: addDays(today, -weekdayOf(today)), to: today };
  const [y, m] = today.split("-");
  if (preset === "month") return { from: `${y}-${m}-01`, to: today };
  const quarterMonth = Math.floor((Number(m) - 1) / 3) * 3 + 1;
  return { from: `${y}-${String(quarterMonth).padStart(2, "0")}-01`, to: today };
}

const noon = (day: CivilDate) => new Date(`${day}T12:00:00`);

/** `יום חמישי, 26 בנובמבר 2026` for one day; `22–26 בנובמבר 2026` and its wider forms for a range. */
export function formatCivilRange({ from, to }: CivilRange): string {
  if (from === to) {
    return noon(from).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  const fmt = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long", year: "numeric" });
  return fmt.formatRange(noon(from), noon(to));
}

export interface DurationPart {
  n: number;
  unit: string;
}

/**
 * A duration as big-number parts. The wall clock reads in days and hours (a
 * box's route is days long); the work clock reads in hours and minutes, since
 * a working day is a fraction of a calendar one and "4 ימים" of work hours
 * would read as four calendar days. Under an hour, both read in minutes.
 */
export function durationParts(seconds: number | null | undefined, largest: "day" | "hour"): DurationPart[] | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return [{ n: minutes, unit: "דק׳" }];
  if (largest === "day" && minutes >= 24 * 60) {
    const hours = Math.round(minutes / 60);
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    const dayPart = { n: days, unit: days === 1 ? "יום" : "ימים" };
    return rest === 0 ? [dayPart] : [dayPart, { n: rest, unit: "שע׳" }];
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? [{ n: hours, unit: "שע׳" }] : [{ n: hours, unit: "שע׳" }, { n: rest, unit: "דק׳" }];
}
