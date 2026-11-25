import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject, requireDbId } from "@/lib/http/request";
import { toHoliday } from "@/lib/workHours/serialize";
import { calendarWrite, holidayColumns, holidayInputOf, refusing } from "../../_lib/write";

export const runtime = "nodejs";

const BAD_ID = "מזהה לא תקין";
const notFound = () => new HttpError(404, "החופשה לא נמצאה");

export const PUT = withAuth<{ id: string }>((req: NextRequest, { params }) => calendarWrite("עדכון החופשה נכשל", async () => {
  const id = requireDbId(params.id, BAD_ID);
  const input = holidayInputOf(await readJsonObject(req, "קלט לא תקין"));
  const saved = await prisma.department_holidays.update({
    where: { id },
    data: holidayColumns(input),
    include: { type: { select: { name: true } } },
  }).catch(refusing({ P2025: notFound(), P2003: new HttpError(400, "סוג החופשה שנבחר אינו קיים") }));
  return NextResponse.json(toHoliday(saved));
}), { role: ACCESS.workHours });

export const DELETE = withAuth<{ id: string }>((_req: NextRequest, { params }) => calendarWrite("מחיקת החופשה נכשלה", async () => {
  const id = requireDbId(params.id, BAD_ID);
  await prisma.department_holidays.delete({ where: { id } }).catch(refusing({ P2025: notFound() }));
  return NextResponse.json({ ok: true });
}), { role: ACCESS.workHours });
