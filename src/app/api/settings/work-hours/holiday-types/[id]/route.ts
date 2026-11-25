import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject, requireDbId } from "@/lib/http/request";
import { toHolidayType } from "@/lib/workHours/serialize";
import { ERR_TYPE_IN_USE } from "@/lib/workHours/types";
import { answer, holidayTypeNameOf, refusing } from "../../_lib/write";

export const runtime = "nodejs";

const BAD_ID = "מזהה לא תקין";
const notFound = () => new HttpError(404, "הסוג לא נמצא");

// A type's name is not in the work calendar, and only an unused type can be deleted: neither
// write changes the calendar, so neither asks for a rebuild.

/** Rename a category — allowed for system types too (they are only un-deletable). */
export const PUT = withAuth<{ id: string }>((req: NextRequest, { params }) => answer("עדכון הסוג נכשל", async () => {
  const id = requireDbId(params.id, BAD_ID);
  const name = holidayTypeNameOf(await readJsonObject(req, "יש להזין שם לסוג"));
  const clash = await prisma.holiday_types.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
  });
  if (clash) throw new HttpError(400, "סוג בשם זה כבר קיים");
  const saved = await prisma.holiday_types.update({ where: { id }, data: { name } }).catch(refusing({ P2025: notFound() }));
  return NextResponse.json(toHolidayType(saved));
}), { role: ACCESS.workHours });

/** Delete a category — blocked for system types and for any type in use. */
export const DELETE = withAuth<{ id: string }>((_req: NextRequest, { params }) => answer("מחיקת הסוג נכשלה", async () => {
  const id = requireDbId(params.id, BAD_ID);
  const type = await prisma.holiday_types.findUnique({
    where: { id },
    include: { _count: { select: { holidays: true } } },
  });
  if (!type) throw notFound();
  if (type.is_system) throw new HttpError(400, "לא ניתן למחוק סוג מערכת");
  if (type._count.holidays > 0) throw new HttpError(400, ERR_TYPE_IN_USE);
  await prisma.holiday_types.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}), { role: ACCESS.workHours });
