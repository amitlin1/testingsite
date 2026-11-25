import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { identityOf } from "@/lib/auth/identity";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { isCivilDate, monthEnd, monthStart } from "@/lib/time/civil";
import { toOverride, stringToDbDate } from "@/lib/workHours/serialize";
import { answer, calendarWrite, overrideColumns, overrideInputOf } from "../_lib/write";

export const runtime = "nodejs";

/** Overrides whose date falls in [from, to] (defaults to the current month). */
export const GET = withAuth((req: NextRequest) => answer("שגיאה בטעינת החריגות", async () => {
  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const from = sp.get("from") ?? monthStart(now.getFullYear(), now.getMonth());
  const to = sp.get("to") ?? monthEnd(now.getFullYear(), now.getMonth());
  if (!isCivilDate(from) || !isCivilDate(to) || from > to) throw new HttpError(400, "טווח תאריכים לא תקין");
  const rows = await prisma.workday_overrides.findMany({
    where: { work_date: { gte: stringToDbDate(from), lte: stringToDbDate(to) } },
    orderBy: { work_date: "asc" },
  });
  return NextResponse.json(rows.map(toOverride));
}), { role: ACCESS.workHours });

/** Create-or-replace the single override for a date (unique per work_date). */
export const POST = withAuth((req: NextRequest, { session }) => calendarWrite("שמירת החריגה נכשלה", async () => {
  const body = await readJsonObject(req, "קלט לא תקין");
  if (typeof body.date !== "string" || !isCivilDate(body.date)) throw new HttpError(400, "קלט לא תקין");
  const input = overrideInputOf(body, body.date);
  const data = overrideColumns(input);
  const saved = await prisma.workday_overrides.upsert({
    where: { work_date: stringToDbDate(input.date) },
    update: { ...data, updated_at: new Date() },
    create: { work_date: stringToDbDate(input.date), ...data, created_by: identityOf(session).username },
  });
  return NextResponse.json(toOverride(saved));
}), { role: ACCESS.workHours });
