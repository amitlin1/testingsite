// Shared contract for the "שעות עבודה וחופשות" feature — used by the route
// handlers, the resolver, and the settings page.
//
// Every clock value is a "HH:mm" string (24h). Every date is a civil
// "YYYY-MM-DD" string in the department's timezone (Asia/Jerusalem) — NOT a
// UTC instant. A work day is a calendar day, so dates carry no time-of-day and
// never cross a timezone boundary.

export type TimeString = string; // "07:00"
export type DateString = string; // "2026-09-17"

/** 0 = ראשון, 1 = שני … 5 = שישי, 6 = שבת */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "ראשון", 1: "שני", 2: "שלישי", 3: "רביעי", 4: "חמישי", 5: "שישי", 6: "שבת",
};

/* -------------------------------------------------------------------------- */
/* Weekly template — the department's default hours per weekday                */
/* -------------------------------------------------------------------------- */

export interface WeekdayDefault {
  weekday: Weekday;
  isWorking: boolean;
  start: TimeString | null;
  end: TimeString | null;
  breakStart: TimeString | null;
  breakEnd: TimeString | null;
}

/* -------------------------------------------------------------------------- */
/* Single-date manual exceptions the timekeeper enters                         */
/* -------------------------------------------------------------------------- */

export type OverrideKind =
  | "vacation"      // יום חופש — 0 שעות
  | "short_hours"   // שעות מקוצרות — שעות חובה
  | "short_day"     // יום קצר — שעות חובה
  | "friday_work"   // עבודה בשישי — רק בתאריך שהוא יום שישי, עד 12:00
  | "eve_work";     // עבודה בערב חג — רק בתאריך שהוא ערב חג, עד 12:00

export const OVERRIDE_LABELS: Record<OverrideKind, string> = {
  vacation: "יום חופש",
  short_hours: "שעות מקוצרות",
  short_day: "יום קצר",
  friday_work: "עבודה בשישי",
  eve_work: "עבודה בערב חג",
};

export interface WorkdayOverride {
  id: number;
  date: DateString;
  kind: OverrideKind;
  start: TimeString | null;
  end: TimeString | null;
  breakStart: TimeString | null;
  breakEnd: TimeString | null;
  note: string | null;
}

export type WorkdayOverrideInput = Omit<WorkdayOverride, "id">;

/* -------------------------------------------------------------------------- */
/* Department-wide internal absences (NOT national holidays — those come from  */
/* the Hebrew-calendar library). e.g. חופשה מרוכזת / יום גיבוש / השבתה.        */
/* -------------------------------------------------------------------------- */

export interface HolidayType {
  id: number;
  name: string;
  /** One of the seeded types — renameable, never deletable. */
  isSystem: boolean;
  /** How many holidays reference it; drives the "בשימוש" column. */
  usageCount?: number;
}

export interface DepartmentHoliday {
  id: number;
  name: string;
  typeId: number;
  typeName: string;
  startDate: DateString;
  endDate: DateString;
  isHalfDay: boolean;
  /** Only when isHalfDay — the department works until this time. */
  halfDayEndTime: TimeString | null;
  note: string | null;
}

export type DepartmentHolidayInput = Omit<DepartmentHoliday, "id" | "typeName">;

/* -------------------------------------------------------------------------- */
/* National holidays — computed from @hebcal/core, never stored/editable.      */
/* -------------------------------------------------------------------------- */

export type IsraeliHolidayCategory =
  | "full_off"  // יו"ט + יום העצמאות — יום חופש מלא, נעול
  | "half_day"  // יום הזיכרון / יום השואה — חצי יום עבודה כברירת מחדל
  | "eve";      // ערב חג — כמו שישי: לא עובדים, ניתן לפתוח חצי יום עד 12:00

export interface IsraeliHolidayInfo {
  date: DateString;
  category: IsraeliHolidayCategory;
  /** Clean Hebrew label, e.g. "ראש השנה" / "ערב פסח" / "יום הזיכרון". */
  label: string;
  /** English descriptor from the library — kept for auditing/debugging. */
  desc: string;
}

/* -------------------------------------------------------------------------- */
/* Resolution — the single source of truth for "what are the hours on date X"  */
/* -------------------------------------------------------------------------- */

export type DaySource = "holiday" | "shabbat" | "override" | "default";

export type DayCategory =
  | "full_off"    // חג מלא / יום העצמאות
  | "shabbat"     // שבת
  | "half_day"    // חצי יום (יום הזיכרון/השואה או חופשה של חצי יום)
  | "eve"         // ערב חג — סגור כברירת מחדל, ניתן לפתוח
  | "vacation"    // יום חופש (חריגה/חופשה)
  | "friday"      // שישי — סגור כברירת מחדל, ניתן לפתוח
  | "working"     // יום עבודה (רגיל / מקוצר / קצר)
  | "off";        // יום שאינו עבודה מסיבה אחרת

export interface ResolvedDay {
  date: DateString;
  weekday: Weekday;
  /** Which layer decided this day. */
  source: DaySource;
  category: DayCategory;
  isWorking: boolean;
  /** National non-working day (full חג / שבת) — the timekeeper cannot edit it. */
  locked: boolean;
  /** A closed day (שישי / ערב חג) that MAY be opened for a half day. */
  canOpenHalfDay: boolean;
  /** Latest end time allowed when opening a half day (e.g. "12:00"). */
  halfDayMaxEnd: TimeString | null;
  start: TimeString | null;
  end: TimeString | null;
  breakStart: TimeString | null;
  breakEnd: TimeString | null;
  /** (end - start) - break, never negative. 0 on a non-working day. */
  netMinutes: number;
  /** "ראש השנה" / "ערב פסח" / "שעות מקוצרות" / null on a plain default day. */
  label: string | null;
  /** Id of the workday_override that decided this day, if any (for "reset"). */
  overrideId: number | null;
  /** Id of the department_holiday that decided this day, if any. */
  holidayId: number | null;
}

export interface WorkHoursContext {
  defaults: WeekdayDefault[];
  overrides: WorkdayOverride[];
  holidays: DepartmentHoliday[];
  israeli: IsraeliHolidayInfo[];
}

/* -------------------------------------------------------------------------- */
/* Validation messages (shared by client + server so they never drift)         */
/* -------------------------------------------------------------------------- */

export const ERR_END_BEFORE_START = "שעת הסיום מוקדמת משעת ההתחלה.";
export const ERR_FRIDAY_ONLY = "ניתן להזין עבודה בשישי רק בתאריך שהוא יום שישי";
export const ERR_EVE_ONLY = "ניתן להזין עבודה בערב חג רק בתאריך שהוא ערב חג";
export const ERR_HALF_DAY_MAX = "בשישי ובערב חג ניתן לעבוד עד השעה 12:00 בלבד";
export const ERR_LOCKED_DAY = "לא ניתן להזין חריגה ביום חג או בשבת";
export const ERR_TYPE_IN_USE = "סוג שנמצא בשימוש אינו ניתן למחיקה";
export const ERR_HOLIDAY_RANGE = "תאריך הסיום מוקדם מתאריך ההתחלה";
