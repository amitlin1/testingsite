import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES, segmentAfter } from "../../_shared";
import { toHolidayType } from "@/lib/workHours/serialize";
import { ERR_TYPE_IN_USE } from "@/lib/workHours/types";

export const runtime = "nodejs";

function idOf(req: NextRequest): number {
  return Number(segmentAfter(req, "holiday-types"));
}

/** Rename a category — allowed for system types too (they are only un-deletable). */
export const PUT = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "יש להזין שם לסוג" }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: "שם ארוך מדי" }, { status: 400 });

  try {
    const clash = await prisma.holiday_types.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
    });
    if (clash) return NextResponse.json({ error: "סוג בשם זה כבר קיים" }, { status: 400 });

    const saved = await prisma.holiday_types.update({ where: { id }, data: { name } });
    return NextResponse.json(toHolidayType(saved));
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "הסוג לא נמצא" }, { status: 404 });
    }
    console.error("work-hours holiday-types PUT", e);
    return NextResponse.json({ error: "עדכון הסוג נכשל" }, { status: 500 });
  }
}, { role: WH_ROLES });

/** Delete a category — blocked for system types and for any type in use. */
export const DELETE = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  try {
    const type = await prisma.holiday_types.findUnique({
      where: { id },
      include: { _count: { select: { holidays: true } } },
    });
    if (!type) return NextResponse.json({ error: "הסוג לא נמצא" }, { status: 404 });
    if (type.is_system) return NextResponse.json({ error: "לא ניתן למחוק סוג מערכת" }, { status: 400 });
    if (type._count.holidays > 0) return NextResponse.json({ error: ERR_TYPE_IN_USE }, { status: 400 });

    await prisma.holiday_types.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("work-hours holiday-types DELETE", e);
    return NextResponse.json({ error: "מחיקת הסוג נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
