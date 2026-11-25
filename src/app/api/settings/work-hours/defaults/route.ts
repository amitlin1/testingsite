import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { toWeekdayDefault } from "@/lib/workHours/serialize";
import { fallbackDefault } from "@/lib/workHours/resolveDay";
import type { Weekday } from "@/lib/time/civil";
import type { WeekdayDefault } from "@/lib/workHours/types";
import { answer } from "../_lib/write";

export const runtime = "nodejs";

/** The weekly template — always exactly 7 rows (ראשון…שבת), filling gaps defensively. */
export const GET = withAuth(() => answer("שגיאה בטעינת שעות ברירת המחדל", async () => {
  const rows = await prisma.weekday_defaults.findMany({ orderBy: { weekday: "asc" } });
  const byWeekday = new Map<number, WeekdayDefault>();
  for (const r of rows) byWeekday.set(r.weekday, toWeekdayDefault(r));
  const all = ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((w) => byWeekday.get(w) ?? fallbackDefault(w));
  return NextResponse.json(all);
}), { role: ACCESS.workHours });
