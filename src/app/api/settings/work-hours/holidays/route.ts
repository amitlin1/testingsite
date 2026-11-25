import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { identityOf } from "@/lib/auth/identity";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { isCivilDate } from "@/lib/time/civil";
import { toHoliday, stringToDbDate } from "@/lib/workHours/serialize";
import { answer, calendarWrite, holidayColumns, holidayInputOf, refusing } from "../_lib/write";

export const runtime = "nodejs";

/** All internal holidays, optionally limited to those overlapping [from,to]. */
export const GET = withAuth((req: NextRequest) => answer("שגיאה בטעינת החופשות", async () => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const where =
    from && to && isCivilDate(from) && isCivilDate(to)
      ? { start_date: { lte: stringToDbDate(to) }, end_date: { gte: stringToDbDate(from) } }
      : {};
  const rows = await prisma.department_holidays.findMany({
    where,
    include: { type: { select: { name: true } } },
    orderBy: { start_date: "asc" },
  });
  return NextResponse.json(rows.map(toHoliday));
}), { role: ACCESS.workHours });

/** Create an internal holiday. */
export const POST = withAuth((req: NextRequest, { session }) => calendarWrite("יצירת החופשה נכשלה", async () => {
  const input = holidayInputOf(await readJsonObject(req, "קלט לא תקין"));
  const created = await prisma.department_holidays.create({
    data: { ...holidayColumns(input), created_by: identityOf(session).username },
    include: { type: { select: { name: true } } },
  }).catch(refusing({ P2003: new HttpError(400, "סוג החופשה שנבחר אינו קיים") }));
  return NextResponse.json(toHoliday(created));
}), { role: ACCESS.workHours });
