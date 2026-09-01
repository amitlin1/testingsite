import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { WH_ROLES, actorOf } from "../_shared";
import { toOverride, stringToDbDate } from "@/lib/workHours/serialize";
import { getIsraeliHolidayForDate } from "@/lib/workHours/israeliHolidays";
import { validateOverride } from "@/lib/workHours/validate";
import { isValidDate, weekdayOf, monthStartISO, monthEndISO } from "@/lib/workHours/time";
import { rebuildWorkCalendar } from "@/lib/work-calendar";
import type { OverrideKind, WorkdayOverrideInput } from "@/lib/workHours/types";

export const runtime = "nodejs";

function parseBody(body: Record<string, unknown> | null): WorkdayOverrideInput | null {
  if (!body || typeof body.date !== "string" || typeof body.kind !== "string") return null;
  return {
    date: body.date,
    kind: body.kind as OverrideKind,
    start: (body.start as string | null) ?? null,
    end: (body.end as string | null) ?? null,
    breakStart: (body.breakStart as string | null) ?? null,
    breakEnd: (body.breakEnd as string | null) ?? null,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  };
}

/** Overrides whose date falls in [from, to] (defaults to the current month). */
export const GET = withAuth(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const now = new Date();
  // monthEndISO, not a hard-coded "-31": that produced 2026-09-31 / 2026-02-31,
  // which isValidDate rejects — the documented default 400'd in every 30-day
  // month and in February.
  const from = sp.get("from") ?? monthStartISO(now.getFullYear(), now.getMonth());
  const to = sp.get("to") ?? monthEndISO(now.getFullYear(), now.getMonth());
  if (!isValidDate(from) || !isValidDate(to) || from > to) {
    return NextResponse.json({ error: "טווח תאריכים לא תקין" }, { status: 400 });
  }
  try {
    const rows = await prisma.workday_overrides.findMany({
      where: { work_date: { gte: stringToDbDate(from), lte: stringToDbDate(to) } },
      orderBy: { work_date: "asc" },
    });
    return NextResponse.json(rows.map(toOverride));
  } catch (e) {
    console.error("work-hours overrides GET", e);
    return NextResponse.json({ error: "שגיאה בטעינת החריגות" }, { status: 500 });
  }
}, { role: WH_ROLES });

/** Create-or-replace the single override for a date (unique per work_date). */
export const POST = withAuth(async (req: NextRequest, ctx: WithAuthCtx) => {
  const input = parseBody((await req.json().catch(() => null)) as Record<string, unknown> | null);
  if (!input || !isValidDate(input.date)) return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });

  const check = validateOverride(input, {
    weekday: weekdayOf(input.date),
    israeli: getIsraeliHolidayForDate(input.date),
  });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const data = {
    kind: input.kind,
    start_time: input.start,
    end_time: input.end,
    break_start: input.breakStart,
    break_end: input.breakEnd,
    note: input.note,
  };
  try {
    const saved = await prisma.workday_overrides.upsert({
      where: { work_date: stringToDbDate(input.date) },
      update: { ...data, updated_at: new Date() },
      create: { work_date: stringToDbDate(input.date), ...data, created_by: actorOf(ctx) },
    });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json(toOverride(saved));
  } catch (e) {
    console.error("work-hours overrides POST", e);
    return NextResponse.json({ error: "שמירת החריגה נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
