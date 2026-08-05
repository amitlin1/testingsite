// DB row ↔ API type mapping. Server-only (the DB layer). @db.Date columns come
// back from Prisma as a Date at UTC midnight, so civil dates are read/written
// with UTC components to avoid any timezone shift.

import type {
  DateString,
  DepartmentHoliday,
  HolidayType,
  OverrideKind,
  TimeString,
  Weekday,
  WeekdayDefault,
  WorkdayOverride,
} from "./types";

/** A Prisma @db.Date value → "YYYY-MM-DD" (UTC components — no tz shift). */
export function dbDateToString(d: Date): DateString {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → a Date at UTC midnight, suitable for a Prisma @db.Date column. */
export function stringToDbDate(s: DateString): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/* ---------- row shapes (structural — no @prisma/client import needed) ---------- */

interface WeekdayDefaultRow {
  weekday: number;
  is_working: boolean;
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
}
interface OverrideRow {
  id: number;
  work_date: Date;
  kind: string;
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
  note: string | null;
}
interface HolidayRow {
  id: number;
  name: string;
  type_id: number;
  start_date: Date;
  end_date: Date;
  is_half_day: boolean;
  half_day_end_time: string | null;
  note: string | null;
  type?: { name: string } | null;
}
interface HolidayTypeRow {
  id: number;
  name: string;
  is_system: boolean;
}

/* ---------- mappers ---------- */

export function toWeekdayDefault(r: WeekdayDefaultRow): WeekdayDefault {
  return {
    weekday: r.weekday as Weekday,
    isWorking: r.is_working,
    start: (r.start_time as TimeString | null) ?? null,
    end: (r.end_time as TimeString | null) ?? null,
    breakStart: (r.break_start as TimeString | null) ?? null,
    breakEnd: (r.break_end as TimeString | null) ?? null,
  };
}

export function toOverride(r: OverrideRow): WorkdayOverride {
  return {
    id: r.id,
    date: dbDateToString(r.work_date),
    kind: r.kind as OverrideKind,
    start: (r.start_time as TimeString | null) ?? null,
    end: (r.end_time as TimeString | null) ?? null,
    breakStart: (r.break_start as TimeString | null) ?? null,
    breakEnd: (r.break_end as TimeString | null) ?? null,
    note: r.note ?? null,
  };
}

export function toHoliday(r: HolidayRow): DepartmentHoliday {
  return {
    id: r.id,
    name: r.name,
    typeId: r.type_id,
    typeName: r.type?.name ?? "",
    startDate: dbDateToString(r.start_date),
    endDate: dbDateToString(r.end_date),
    isHalfDay: r.is_half_day,
    halfDayEndTime: (r.half_day_end_time as TimeString | null) ?? null,
    note: r.note ?? null,
  };
}

export function toHolidayType(r: HolidayTypeRow, usageCount?: number): HolidayType {
  return { id: r.id, name: r.name, isSystem: r.is_system, usageCount };
}
