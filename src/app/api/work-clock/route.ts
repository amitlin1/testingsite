import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ensureWorkCalendar } from "@/app/lib/metrics/ledger/calendar-sync";
import { fallbackDefault } from "@/lib/workHours/resolveDay";
import { netMinutes } from "@/lib/workHours/time";
import { dbDateToString, toWeekdayDefault } from "@/lib/workHours/serialize";
import type { Weekday } from "@/lib/time/civil";
import type { WorkClockWire } from "@/app/lib/dashboard/work-clock";

export const runtime = "nodejs";

/**
 * GET /api/work-clock — what the "ברוטו / נטו" explanation panel shows: the
 * weekly hours net time is counted by (the same rows, with the same code
 * fallback, the calendar build reads), whether anyone has changed them on the
 * work-hours screen yet, and whether the work calendar is built. Read-only and
 * open to every signed-in user: the item screens show net time too.
 */
export const GET = withAuth(async () => {
  try {
    await ensureWorkCalendar();
    const [rows, overrides, holidays, cal] = await Promise.all([
      prisma.weekday_defaults.findMany({ orderBy: { weekday: "asc" } }),
      prisma.workday_overrides.count(),
      prisma.department_holidays.count(),
      prisma.$queryRaw<{ horizon_to: Date }[]>`SELECT horizon_to FROM work_calendar_version WHERE is_current`,
    ]);
    const byWeekday = new Map(rows.map((r) => [r.weekday, toWeekdayDefault(r)]));
    const week = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((w) => {
      const d = byWeekday.get(w) ?? fallbackDefault(w);
      return { ...d, netMinutes: d.isWorking ? netMinutes(d.start, d.end, d.breakStart, d.breakEnd) : 0 };
    });
    const body: WorkClockWire = {
      week,
      hoursCustomized: rows.some((r) => r.updated_by != null),
      exceptions: overrides + holidays,
      calendarHorizonTo: cal[0] ? dbDateToString(cal[0].horizon_to) : null,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("work-clock", error);
    return NextResponse.json({ error: "שגיאה בטעינת שעות העבודה" }, { status: 500 });
  }
});
