import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES, segmentAfter } from "../../_shared";
import { toHoliday, stringToDbDate } from "@/lib/workHours/serialize";
import { validateHoliday } from "@/lib/workHours/validate";
import { rebuildWorkCalendar } from "@/lib/work-calendar";
import type { DepartmentHolidayInput } from "@/lib/workHours/types";

export const runtime = "nodejs";

function idOf(req: NextRequest): number {
  return Number(segmentAfter(req, "holidays"));
}

export const PUT = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string") return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });

  const input: DepartmentHolidayInput = {
    name: body.name.trim(),
    typeId: Number(body.typeId),
    startDate: String(body.startDate ?? ""),
    endDate: String(body.endDate ?? ""),
    isHalfDay: !!body.isHalfDay,
    halfDayEndTime: body.isHalfDay ? ((body.halfDayEndTime as string | null) ?? null) : null,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
  const check = validateHoliday(input);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const saved = await prisma.department_holidays.update({
      where: { id },
      data: {
        name: input.name,
        type_id: input.typeId,
        start_date: stringToDbDate(input.startDate),
        end_date: stringToDbDate(input.endDate),
        is_half_day: input.isHalfDay,
        half_day_end_time: input.halfDayEndTime,
        note: input.note,
      },
      include: { type: { select: { name: true } } },
    });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json(toHoliday(saved));
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "החופשה לא נמצאה" }, { status: 404 });
    if (code === "P2003") return NextResponse.json({ error: "סוג החופשה שנבחר אינו קיים" }, { status: 400 });
    console.error("work-hours holidays PUT", e);
    return NextResponse.json({ error: "עדכון החופשה נכשל" }, { status: 500 });
  }
}, { role: WH_ROLES });

export const DELETE = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  try {
    await prisma.department_holidays.delete({ where: { id } });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "החופשה לא נמצאה" }, { status: 404 });
    }
    console.error("work-hours holidays DELETE", e);
    return NextResponse.json({ error: "מחיקת החופשה נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
