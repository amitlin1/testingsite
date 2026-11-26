import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { identityOf } from "@/lib/auth/identity";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { toWeekdayDefault } from "@/lib/workHours/serialize";
import { validateWeekdayDefault } from "@/lib/workHours/validate";
import type { Weekday } from "@/lib/time/civil";
import { calendarWrite } from "../../_lib/write";

export const runtime = "nodejs";

/** Update one weekday of the weekly template. */
export const PUT = withAuth<{ weekday: string }>((req: NextRequest, { session, params }) => calendarWrite("שמירת היום נכשלה", async () => {
  const weekday = Number(params.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, "יום בשבוע לא תקין");

  const body = await readJsonObject(req, "קלט לא תקין");
  const isWorking = !!body.isWorking;
  const start = isWorking ? ((body.start as string | null) ?? null) : null;
  const end = isWorking ? ((body.end as string | null) ?? null) : null;
  const breakStart = isWorking ? ((body.breakStart as string | null) ?? null) : null;
  const breakEnd = isWorking ? ((body.breakEnd as string | null) ?? null) : null;

  const check = validateWeekdayDefault({ weekday: weekday as Weekday, isWorking, start, end, breakStart, breakEnd });
  if (!check.ok) throw new HttpError(400, check.error);

  const columns = {
    is_working: isWorking, start_time: start, end_time: end, break_start: breakStart, break_end: breakEnd,
    updated_by: identityOf(session).username,
  };
  const saved = await prisma.weekday_defaults.upsert({ where: { weekday }, update: columns, create: { weekday, ...columns } });
  return NextResponse.json(toWeekdayDefault(saved));
}), { perm: ACCESS.workHours });
