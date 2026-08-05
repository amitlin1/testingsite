import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { WH_ROLES, segmentAfter } from "../../_shared";
import { toOverride, dbDateToString } from "@/lib/workHours/serialize";
import { getIsraeliHolidayForDate } from "@/lib/workHours/israeliHolidays";
import { validateOverride } from "@/lib/workHours/validate";
import { weekdayOf } from "@/lib/workHours/time";
import type { OverrideKind } from "@/lib/workHours/types";

export const runtime = "nodejs";

function idOf(req: NextRequest): number {
  return Number(segmentAfter(req, "overrides"));
}

/** Edit an existing override; the date is fixed to the stored record. */
export const PUT = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const existing = await prisma.workday_overrides.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "החריגה לא נמצאה" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.kind !== "string") return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });

  const date = dbDateToString(existing.work_date);
  const input = {
    date,
    kind: body.kind as OverrideKind,
    start: (body.start as string | null) ?? null,
    end: (body.end as string | null) ?? null,
    breakStart: (body.breakStart as string | null) ?? null,
    breakEnd: (body.breakEnd as string | null) ?? null,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
  const check = validateOverride(input, { weekday: weekdayOf(date), israeli: getIsraeliHolidayForDate(date) });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const saved = await prisma.workday_overrides.update({
      where: { id },
      data: {
        kind: input.kind,
        start_time: input.start,
        end_time: input.end,
        break_start: input.breakStart,
        break_end: input.breakEnd,
        note: input.note,
      },
    });
    return NextResponse.json(toOverride(saved));
  } catch (e) {
    console.error("work-hours overrides PUT", e);
    return NextResponse.json({ error: "עדכון החריגה נכשל" }, { status: 500 });
  }
}, { role: WH_ROLES });

/** "אפס לברירת מחדל" — remove the override for its date. */
export const DELETE = withAuth(async (req: NextRequest) => {
  const id = idOf(req);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  try {
    await prisma.workday_overrides.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("work-hours overrides DELETE", e);
    return NextResponse.json({ error: "מחיקת החריגה נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
