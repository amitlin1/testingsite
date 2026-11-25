import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject, requireDbId } from "@/lib/http/request";
import { toOverride, dbDateToString } from "@/lib/workHours/serialize";
import { calendarWrite, overrideColumns, overrideInputOf } from "../../_lib/write";

export const runtime = "nodejs";

const BAD_ID = "מזהה לא תקין";

/** Edit an existing override; the date is fixed to the stored record. */
export const PUT = withAuth<{ id: string }>((req: NextRequest, { params }) => calendarWrite("עדכון החריגה נכשל", async () => {
  const id = requireDbId(params.id, BAD_ID);
  const existing = await prisma.workday_overrides.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "החריגה לא נמצאה");
  const input = overrideInputOf(await readJsonObject(req, "קלט לא תקין"), dbDateToString(existing.work_date));
  const saved = await prisma.workday_overrides.update({ where: { id }, data: overrideColumns(input) });
  return NextResponse.json(toOverride(saved));
}), { role: ACCESS.workHours });

/** "אפס לברירת מחדל" — remove the override for its date. */
export const DELETE = withAuth<{ id: string }>((_req: NextRequest, { params }) => calendarWrite("מחיקת החריגה נכשלה", async () => {
  const id = requireDbId(params.id, BAD_ID);
  await prisma.workday_overrides.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}), { role: ACCESS.workHours });
