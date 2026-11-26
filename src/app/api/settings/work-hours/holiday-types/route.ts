import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { toHolidayType } from "@/lib/workHours/serialize";
import { answer, holidayTypeNameOf, refusing } from "../_lib/write";

export const runtime = "nodejs";

const nameTaken = () => new HttpError(400, "סוג בשם זה כבר קיים");

/** All holiday categories, system ones first, each with its usage count. */
export const GET = withAuth(() => answer("שגיאה בטעינת סוגי החופשה", async () => {
  const rows = await prisma.holiday_types.findMany({
    include: { _count: { select: { holidays: true } } },
    orderBy: [{ is_system: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(rows.map((r) => toHolidayType(r, r._count.holidays)));
}), { perm: ACCESS.workHours });

/** Add a user-defined category. A type's name is not in the work calendar: no rebuild. */
export const POST = withAuth((req: NextRequest) => answer("יצירת הסוג נכשלה", async () => {
  const name = holidayTypeNameOf(await readJsonObject(req, "יש להזין שם לסוג"));
  const existing = await prisma.holiday_types.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing) throw nameTaken();
  const created = await prisma.holiday_types.create({ data: { name, is_system: false } }).catch(refusing({ P2002: nameTaken() }));
  return NextResponse.json(toHolidayType(created, 0));
}), { perm: ACCESS.workHours });
