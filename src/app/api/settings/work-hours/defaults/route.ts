import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES } from "../_shared";
import { toWeekdayDefault } from "@/lib/workHours/serialize";
import type { Weekday, WeekdayDefault } from "@/lib/workHours/types";

export const runtime = "nodejs";

const FALLBACK = (weekday: Weekday): WeekdayDefault =>
  weekday <= 4
    ? { weekday, isWorking: true, start: "07:00", end: "15:35", breakStart: "12:00", breakEnd: "13:00" }
    : { weekday, isWorking: false, start: null, end: null, breakStart: null, breakEnd: null };

/** The weekly template — always exactly 7 rows (ראשון…שבת), filling gaps defensively. */
export const GET = withAuth(async () => {
  try {
    const rows = await prisma.weekday_defaults.findMany({ orderBy: { weekday: "asc" } });
    const byWeekday = new Map<number, WeekdayDefault>();
    for (const r of rows) byWeekday.set(r.weekday, toWeekdayDefault(r));
    const all = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((w) => byWeekday.get(w) ?? FALLBACK(w));
    return NextResponse.json(all);
  } catch (e) {
    console.error("work-hours defaults GET", e);
    return NextResponse.json({ error: "שגיאה בטעינת שעות ברירת המחדל" }, { status: 500 });
  }
}, { role: WH_ROLES });
