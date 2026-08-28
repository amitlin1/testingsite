import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { WH_ROLES, actorOf } from "../_shared";
import { toHoliday, stringToDbDate } from "@/lib/workHours/serialize";
import { validateHoliday } from "@/lib/workHours/validate";
import { isValidDate } from "@/lib/workHours/time";
import { rebuildWorkCalendar } from "@/lib/work-calendar";
import type { DepartmentHolidayInput } from "@/lib/workHours/types";

export const runtime = "nodejs";

function parseBody(body: Record<string, unknown> | null): DepartmentHolidayInput | null {
  if (!body || typeof body.name !== "string") return null;
  return {
    name: body.name.trim(),
    typeId: Number(body.typeId),
    startDate: String(body.startDate ?? ""),
    endDate: String(body.endDate ?? ""),
    isHalfDay: !!body.isHalfDay,
    halfDayEndTime: body.isHalfDay ? ((body.halfDayEndTime as string | null) ?? null) : null,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
}

/** All internal holidays, optionally limited to those overlapping [from,to]. */
export const GET = withAuth(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const where =
    from && to && isValidDate(from) && isValidDate(to)
      ? { start_date: { lte: stringToDbDate(to) }, end_date: { gte: stringToDbDate(from) } }
      : {};
  try {
    const rows = await prisma.department_holidays.findMany({
      where,
      include: { type: { select: { name: true } } },
      orderBy: { start_date: "asc" },
    });
    return NextResponse.json(rows.map(toHoliday));
  } catch (e) {
    console.error("work-hours holidays GET", e);
    return NextResponse.json({ error: "שגיאה בטעינת החופשות" }, { status: 500 });
  }
}, { role: WH_ROLES });

/** Create an internal holiday. */
export const POST = withAuth(async (req: NextRequest, ctx: WithAuthCtx) => {
  const input = parseBody((await req.json().catch(() => null)) as Record<string, unknown> | null);
  if (!input) return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });

  const check = validateHoliday(input);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const created = await prisma.department_holidays.create({
      data: {
        name: input.name,
        type_id: input.typeId,
        start_date: stringToDbDate(input.startDate),
        end_date: stringToDbDate(input.endDate),
        is_half_day: input.isHalfDay,
        half_day_end_time: input.halfDayEndTime,
        note: input.note,
        created_by: actorOf(ctx),
      },
      include: { type: { select: { name: true } } },
    });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json(toHoliday(created));
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2003") {
      return NextResponse.json({ error: "סוג החופשה שנבחר אינו קיים" }, { status: 400 });
    }
    console.error("work-hours holidays POST", e);
    return NextResponse.json({ error: "יצירת החופשה נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
