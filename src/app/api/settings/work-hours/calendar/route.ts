import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES } from "../_shared";
import { toWeekdayDefault, toOverride, toHoliday, stringToDbDate } from "@/lib/workHours/serialize";
import { getIsraeliHolidays } from "@/lib/workHours/israeliHolidays";
import { resolveRange } from "@/lib/workHours/resolveDay";
import { isValidDate, daysBetween } from "@/lib/workHours/time";
import type { WeekdayDefault, Weekday } from "@/lib/workHours/types";

export const runtime = "nodejs";

// Resolving a range is O(days × holidays) and walks the Hebrew calendar once per
// YEAR it spans, so an unbounded range is a one-request DoS
// (?from=1900-01-01&to=2999-12-31 → ~400k days + 1100 years of hebcal). The UI
// never asks for more than one month; two years is generous headroom.
const MAX_RANGE_DAYS = 731;

const FALLBACK = (weekday: Weekday): WeekdayDefault =>
  weekday <= 4
    ? { weekday, isWorking: true, start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" }
    : { weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null };

/**
 * The resolved calendar for [from, to]: one `ResolvedDay` per date, folding the
 * weekly template, manual overrides, internal holidays and the national
 * (Hebrew-calendar) days through the single shared resolver.
 */
export const GET = withAuth(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return NextResponse.json({ error: "טווח תאריכים לא תקין" }, { status: 400 });
  }
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: "טווח התאריכים רחב מדי" }, { status: 400 });
  }

  try {
    const [defaultRows, overrideRows, holidayRows] = await Promise.all([
      prisma.weekday_defaults.findMany({ orderBy: { weekday: "asc" } }),
      prisma.workday_overrides.findMany({
        where: { work_date: { gte: stringToDbDate(from), lte: stringToDbDate(to) } },
      }),
      prisma.department_holidays.findMany({
        where: { start_date: { lte: stringToDbDate(to) }, end_date: { gte: stringToDbDate(from) } },
        include: { type: { select: { name: true } } },
      }),
    ]);

    const byWeekday = new Map<number, WeekdayDefault>();
    for (const r of defaultRows) byWeekday.set(r.weekday, toWeekdayDefault(r));
    const defaults = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((w) => byWeekday.get(w) ?? FALLBACK(w));

    const overrides = overrideRows.map(toOverride);
    const holidays = holidayRows.map(toHoliday);
    const israeli = getIsraeliHolidays(from, to);

    const days = resolveRange(from, to, { defaults, overrides, holidays, israeli });

    // `israeli` is returned too so the day-editor knows a date's underlying
    // nature (חג-מלא / חצי-יום / ערב-חג) even when an override masks it.
    return NextResponse.json({ from, to, days, israeli });
  } catch (e) {
    console.error("work-hours calendar GET", e);
    return NextResponse.json({ error: "שגיאה בטעינת הלוח" }, { status: 500 });
  }
}, { role: WH_ROLES });
