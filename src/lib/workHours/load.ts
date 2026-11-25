// The work-hours sources for a range, read and mapped once — for the settings
// calendar (GET /api/settings/work-hours/calendar) and the ledger's work-calendar
// rebuild alike, so a new source table is added in one place. Server-only.
//
// Ordered (weekday, date, id) so the rebuild's source digest is stable. The
// national holidays are not here: their library loads differently in the two
// callers (metrics/ledger/work-calendar.ts imports it dynamically).

import type { TransactionClient } from "@/lib/db";
import { stringToDbDate, toHoliday, toOverride, toWeekdayDefault } from "./serialize";
import type { DateString, WorkHoursContext } from "./types";

type Sources = Pick<TransactionClient, "weekday_defaults" | "workday_overrides" | "department_holidays">;

export async function loadWorkHoursSources(
  db: Sources,
  from: DateString,
  to: DateString,
): Promise<Omit<WorkHoursContext, "israeli">> {
  const [defaultRows, overrideRows, holidayRows] = await Promise.all([
    db.weekday_defaults.findMany({ orderBy: { weekday: "asc" } }),
    db.workday_overrides.findMany({
      where: { work_date: { gte: stringToDbDate(from), lte: stringToDbDate(to) } },
      orderBy: { work_date: "asc" },
    }),
    db.department_holidays.findMany({
      where: { start_date: { lte: stringToDbDate(to) }, end_date: { gte: stringToDbDate(from) } },
      include: { type: { select: { name: true } } },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    defaults: defaultRows.map(toWeekdayDefault),
    overrides: overrideRows.map(toOverride),
    holidays: holidayRows.map(toHoliday),
  };
}
