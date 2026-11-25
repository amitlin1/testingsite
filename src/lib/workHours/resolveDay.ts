// The single computational core: given the weekly template, the manual
// exceptions, the department's internal holidays and the national (Hebrew-
// calendar) days, decide the working hours of ONE civil date.
//
// Precedence, highest wins (see the feature spec / tests):
//   1. National full holiday (יו"ט / יום העצמאות)      → non-working, LOCKED
//   2. שבת                                              → non-working, LOCKED
//   3. Department internal holiday covering the date    → full off / half day
//   4. Manual workday override for the date             → per kind
//   5. National half day (יום הזיכרון / יום השואה)      → half working day
//   6. National ערב חג                                  → closed, may open to 12:00
//   7. שישי                                              → closed, may open to 12:00
//   8. Weekly template (ראשון–חמישי)                    → working / off
//
// Pure: no clock, no I/O. The settings calendar and the ledger's work calendar
// (metrics/ledger/work-calendar.ts) both resolve through `resolveRange`, so the
// screen and the work clock cannot disagree on a day.

import { FRIDAY, SATURDAY, eachDate, weekdayOf, type Weekday } from "@/lib/time/civil";
import type {
  DateString,
  DepartmentHoliday,
  IsraeliHolidayInfo,
  ResolvedDay,
  WeekdayDefault,
  WorkdayOverride,
  WorkHoursContext,
} from "./types";
import { OVERRIDE_LABELS } from "./types";
import {
  DEFAULT_BREAK_END,
  DEFAULT_BREAK_START,
  DEFAULT_END,
  DEFAULT_START,
  HALF_DAY_END,
  netMinutes,
} from "./time";

export interface ResolveDayInput {
  date: DateString;
  weekday: Weekday;
  weekdayDefault: WeekdayDefault;
  israeli: IsraeliHolidayInfo | null;
  override: WorkdayOverride | null;
  departmentHoliday: DepartmentHoliday | null;
}

/** Base shape — a plain non-working day; each branch overwrites what it needs. */
function base(date: DateString, weekday: Weekday): ResolvedDay {
  return {
    date,
    weekday,
    source: "default",
    category: "off",
    isWorking: false,
    locked: false,
    canOpenHalfDay: false,
    halfDayMaxEnd: null,
    start: null,
    end: null,
    breakStart: null,
    breakEnd: null,
    netMinutes: 0,
    label: null,
    overrideId: null,
    holidayId: null,
  };
}

export function resolveDay(input: ResolveDayInput): ResolvedDay {
  const { date, weekday, weekdayDefault, israeli, override, departmentHoliday } = input;
  const day = base(date, weekday);

  if (israeli?.category === "full_off") {
    return { ...day, source: "holiday", category: "full_off", locked: true, label: israeli.label };
  }

  if (weekday === SATURDAY) {
    return { ...day, source: "shabbat", category: "shabbat", locked: true, label: "שבת" };
  }

  if (departmentHoliday) {
    if (departmentHoliday.isHalfDay) {
      const start = weekdayDefault.start ?? DEFAULT_START;
      const end = departmentHoliday.halfDayEndTime ?? HALF_DAY_END;
      return {
        ...day,
        source: "holiday",
        category: "half_day",
        isWorking: true,
        start,
        end,
        netMinutes: netMinutes(start, end, null, null),
        label: departmentHoliday.name,
        holidayId: departmentHoliday.id,
      };
    }
    return {
      ...day,
      source: "holiday",
      category: "vacation",
      label: departmentHoliday.name,
      holidayId: departmentHoliday.id,
    };
  }

  // friday_work / eve_work count only on a matching date; a stale one falls
  // through to the layers below.
  if (override) {
    const applies =
      override.kind === "friday_work"
        ? weekday === FRIDAY
        : override.kind === "eve_work"
          ? israeli?.category === "eve"
          : true;
    if (applies) {
      if (override.kind === "vacation") {
        return {
          ...day,
          source: "override",
          category: "vacation",
          label: OVERRIDE_LABELS.vacation,
          overrideId: override.id,
        };
      }
      const label =
        override.kind === "eve_work" && israeli
          ? israeli.label
          : OVERRIDE_LABELS[override.kind];
      return {
        ...day,
        source: "override",
        category: "working",
        isWorking: true,
        start: override.start,
        end: override.end,
        breakStart: override.breakStart,
        breakEnd: override.breakEnd,
        netMinutes: netMinutes(override.start, override.end, override.breakStart, override.breakEnd),
        label,
        overrideId: override.id,
      };
    }
  }

  if (israeli?.category === "half_day") {
    const start = weekdayDefault.start ?? DEFAULT_START;
    return {
      ...day,
      source: "holiday",
      category: "half_day",
      isWorking: true,
      start,
      end: HALF_DAY_END,
      netMinutes: netMinutes(start, HALF_DAY_END, null, null),
      label: israeli.label,
    };
  }

  if (israeli?.category === "eve") {
    return {
      ...day,
      source: "holiday",
      category: "eve",
      canOpenHalfDay: true,
      halfDayMaxEnd: HALF_DAY_END,
      label: israeli.label,
    };
  }

  const templateWorks = weekdayDefault.isWorking && !!weekdayDefault.start && !!weekdayDefault.end;
  // שישי is closed unless the weekly template turns it on.
  if (weekday === FRIDAY && !templateWorks) {
    return { ...day, category: "friday", canOpenHalfDay: true, halfDayMaxEnd: HALF_DAY_END };
  }

  if (templateWorks) {
    return {
      ...day,
      category: "working",
      isWorking: true,
      start: weekdayDefault.start,
      end: weekdayDefault.end,
      breakStart: weekdayDefault.breakStart,
      breakEnd: weekdayDefault.breakEnd,
      netMinutes: netMinutes(
        weekdayDefault.start,
        weekdayDefault.end,
        weekdayDefault.breakStart,
        weekdayDefault.breakEnd,
      ),
    };
  }
  return day;
}

/** The template of a weekday the DB has no row for: ראשון–חמישי work the default hours. */
export function fallbackDefault(weekday: Weekday): WeekdayDefault {
  return weekday <= 4
    ? {
        weekday,
        isWorking: true,
        start: DEFAULT_START,
        end: DEFAULT_END,
        breakStart: DEFAULT_BREAK_START,
        breakEnd: DEFAULT_BREAK_END,
      }
    : { weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null };
}

/** Pick the department holiday that decides a date: full-day beats half-day. */
function pickHoliday(date: DateString, holidays: DepartmentHoliday[]): DepartmentHoliday | null {
  const covering = holidays.filter((h) => date >= h.startDate && date <= h.endDate);
  if (covering.length === 0) return null;
  covering.sort((a, b) => {
    if (a.isHalfDay !== b.isHalfDay) return a.isHalfDay ? 1 : -1; // full day first
    return a.id - b.id;
  });
  return covering[0];
}

/** Resolve every civil date in [from, to] inclusive. */
export function resolveRange(
  from: DateString,
  to: DateString,
  ctx: WorkHoursContext,
): ResolvedDay[] {
  const defaultsByWeekday = new Map<Weekday, WeekdayDefault>();
  for (const d of ctx.defaults) defaultsByWeekday.set(d.weekday, d);

  const overrideByDate = new Map<DateString, WorkdayOverride>();
  for (const o of ctx.overrides) overrideByDate.set(o.date, o);

  const israeliByDate = new Map<DateString, IsraeliHolidayInfo>();
  for (const h of ctx.israeli) israeliByDate.set(h.date, h);

  return eachDate(from, to).map((date) => {
    const weekday = weekdayOf(date);
    return resolveDay({
      date,
      weekday,
      weekdayDefault: defaultsByWeekday.get(weekday) ?? fallbackDefault(weekday),
      israeli: israeliByDate.get(date) ?? null,
      override: overrideByDate.get(date) ?? null,
      departmentHoliday: pickHoliday(date, ctx.holidays),
    });
  });
}
