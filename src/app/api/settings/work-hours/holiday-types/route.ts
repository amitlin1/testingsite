import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES } from "../_shared";
import { toHolidayType } from "@/lib/workHours/serialize";
import { rebuildWorkCalendar } from "@/lib/work-calendar";

export const runtime = "nodejs";

/** All holiday categories, system ones first, each with its usage count. */
export const GET = withAuth(async () => {
  try {
    const rows = await prisma.holiday_types.findMany({
      include: { _count: { select: { holidays: true } } },
      orderBy: [{ is_system: "desc" }, { name: "asc" }],
    });
    return NextResponse.json(rows.map((r) => toHolidayType(r, r._count.holidays)));
  } catch (e) {
    console.error("work-hours holiday-types GET", e);
    return NextResponse.json({ error: "שגיאה בטעינת סוגי החופשה" }, { status: 500 });
  }
}, { role: WH_ROLES });

/** Add a user-defined category. */
export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "יש להזין שם לסוג" }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: "שם ארוך מדי" }, { status: 400 });

  try {
    const existing = await prisma.holiday_types.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (existing) return NextResponse.json({ error: "סוג בשם זה כבר קיים" }, { status: 400 });

    const created = await prisma.holiday_types.create({ data: { name, is_system: false } });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json(toHolidayType(created, 0));
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "סוג בשם זה כבר קיים" }, { status: 400 });
    }
    console.error("work-hours holiday-types POST", e);
    return NextResponse.json({ error: "יצירת הסוג נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
