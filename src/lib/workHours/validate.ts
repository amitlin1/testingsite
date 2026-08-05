// Pure validation shared by the API handlers and the dialogs, so client and
// server enforce identical rules and the same Hebrew messages.

import type {
  DepartmentHolidayInput,
  IsraeliHolidayInfo,
  OverrideKind,
  Weekday,
  WeekdayDefault,
  WorkdayOverrideInput,
} from "./types";
import {
  ERR_END_BEFORE_START,
  ERR_EVE_ONLY,
  ERR_FRIDAY_ONLY,
  ERR_HALF_DAY_MAX,
  ERR_HOLIDAY_RANGE,
  ERR_LOCKED_DAY,
} from "./types";
import { HALF_DAY_END, isEndBeforeStart, isValidDate, isValidTime, toMinutes } from "./time";

export type ValidationResult = { ok: true } | { ok: false; error: string };

const OK: ValidationResult = { ok: true };
const OVERRIDE_KINDS: OverrideKind[] = [
  "vacation",
  "short_hours",
  "short_day",
  "friday_work",
  "eve_work",
];

/** end must be strictly after start, and both well-formed. */
function validWorkingHours(start: string | null, end: string | null): ValidationResult {
  if (!isValidTime(start) || !isValidTime(end)) {
    return { ok: false, error: "יש להזין שעת התחלה ושעת סיום תקינות" };
  }
  if (isEndBeforeStart(start, end)) return { ok: false, error: ERR_END_BEFORE_START };
  return OK;
}

/** A break, if present, must be a real interval inside the working window. */
function validBreak(
  start: string,
  end: string,
  breakStart: string | null,
  breakEnd: string | null,
): ValidationResult {
  if (!breakStart && !breakEnd) return OK;
  if (!isValidTime(breakStart) || !isValidTime(breakEnd)) {
    return { ok: false, error: "הפסקה חייבת לכלול שעת התחלה ושעת סיום תקינות" };
  }
  if (isEndBeforeStart(breakStart, breakEnd)) {
    return { ok: false, error: "סיום ההפסקה מוקדם מתחילת ההפסקה" };
  }
  if (toMinutes(breakStart) < toMinutes(start) || toMinutes(breakEnd) > toMinutes(end)) {
    return { ok: false, error: "ההפסקה חייבת להיות בתוך שעות העבודה" };
  }
  return OK;
}

/** Half-day work (שישי / ערב חג) may not run past 12:00. */
function withinHalfDayCap(end: string): ValidationResult {
  return toMinutes(end) <= toMinutes(HALF_DAY_END) ? OK : { ok: false, error: ERR_HALF_DAY_MAX };
}

/**
 * Validate a single-date override for a specific date.
 * `ctx.weekday`/`ctx.israeli` describe the target date so we can reject work on
 * a locked national day and confirm friday_work / eve_work land where allowed.
 */
export function validateOverride(
  input: WorkdayOverrideInput,
  ctx: { weekday: Weekday; israeli: IsraeliHolidayInfo | null },
): ValidationResult {
  if (!isValidDate(input.date)) return { ok: false, error: "תאריך לא תקין" };
  if (!OVERRIDE_KINDS.includes(input.kind)) return { ok: false, error: "סוג חריגה לא תקין" };

  // A locked national day (full חג) or שבת can never carry a work/leave override.
  if (ctx.israeli?.category === "full_off" || ctx.weekday === 6) {
    return { ok: false, error: ERR_LOCKED_DAY };
  }

  switch (input.kind) {
    case "vacation":
      return OK;

    case "short_hours":
    case "short_day": {
      const h = validWorkingHours(input.start, input.end);
      if (!h.ok) return h;
      return validBreak(input.start!, input.end!, input.breakStart, input.breakEnd);
    }

    case "friday_work": {
      if (ctx.weekday !== 5) return { ok: false, error: ERR_FRIDAY_ONLY };
      const h = validWorkingHours(input.start, input.end);
      if (!h.ok) return h;
      const cap = withinHalfDayCap(input.end!);
      if (!cap.ok) return cap;
      return validBreak(input.start!, input.end!, input.breakStart, input.breakEnd);
    }

    case "eve_work": {
      if (ctx.israeli?.category !== "eve") return { ok: false, error: ERR_EVE_ONLY };
      const h = validWorkingHours(input.start, input.end);
      if (!h.ok) return h;
      const cap = withinHalfDayCap(input.end!);
      if (!cap.ok) return cap;
      return validBreak(input.start!, input.end!, input.breakStart, input.breakEnd);
    }
  }
}

/** Validate a weekly-template row edit. */
export function validateWeekdayDefault(input: WeekdayDefault): ValidationResult {
  if (![0, 1, 2, 3, 4, 5, 6].includes(input.weekday)) {
    return { ok: false, error: "יום בשבוע לא תקין" };
  }
  if (input.weekday === 6) return { ok: false, error: "לא ניתן להפעיל עבודה בשבת" };
  if (!input.isWorking) return OK;
  const h = validWorkingHours(input.start, input.end);
  if (!h.ok) return h;
  // שישי, if opened in the template, is still a half day capped at 12:00.
  if (input.weekday === 5) {
    const cap = withinHalfDayCap(input.end!);
    if (!cap.ok) return cap;
  }
  return validBreak(input.start!, input.end!, input.breakStart, input.breakEnd);
}

/** Validate a department internal-holiday create/edit. */
export function validateHoliday(input: DepartmentHolidayInput): ValidationResult {
  if (!input.name || !input.name.trim()) return { ok: false, error: "יש להזין שם לחופשה" };
  if (!isValidDate(input.startDate) || !isValidDate(input.endDate)) {
    return { ok: false, error: "תאריכים לא תקינים" };
  }
  if (input.endDate < input.startDate) return { ok: false, error: ERR_HOLIDAY_RANGE };
  if (input.isHalfDay && !isValidTime(input.halfDayEndTime)) {
    return { ok: false, error: "יש להזין שעת סיום תקינה ליום חצי" };
  }
  if (!Number.isInteger(input.typeId) || input.typeId <= 0) {
    return { ok: false, error: "יש לבחור סוג חופשה" };
  }
  return OK;
}
