import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { WH_ROLES, actorOf, segmentAfter } from "../../_shared";
import { toWeekdayDefault } from "@/lib/workHours/serialize";
import { validateWeekdayDefault } from "@/lib/workHours/validate";
import { rebuildWorkCalendar } from "@/lib/work-calendar";
import type { Weekday } from "@/lib/workHours/types";

export const runtime = "nodejs";

/** Update one weekday of the weekly template. */
export const PUT = withAuth(async (req: NextRequest, ctx: WithAuthCtx) => {
  const weekday = Number(segmentAfter(req, "defaults"));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return NextResponse.json({ error: "יום בשבוע לא תקין" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });

  const isWorking = !!body.isWorking;
  const start = isWorking ? ((body.start as string | null) ?? null) : null;
  const end = isWorking ? ((body.end as string | null) ?? null) : null;
  const breakStart = isWorking ? ((body.breakStart as string | null) ?? null) : null;
  const breakEnd = isWorking ? ((body.breakEnd as string | null) ?? null) : null;

  const check = validateWeekdayDefault({
    weekday: weekday as Weekday,
    isWorking,
    start,
    end,
    breakStart,
    breakEnd,
  });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const saved = await prisma.weekday_defaults.upsert({
      where: { weekday },
      update: { is_working: isWorking, start_time: start, end_time: end, break_start: breakStart, break_end: breakEnd, updated_by: actorOf(ctx) },
      create: { weekday, is_working: isWorking, start_time: start, end_time: end, break_start: breakStart, break_end: breakEnd, updated_by: actorOf(ctx) },
    });
    // §7.4: every work-hours write refreshes the versioned calendar. Fire-and-
    // forget — the user's save never waits on, or fails with, the rebuild.
    rebuildWorkCalendar(prisma).catch((err) => console.error("work-calendar rebuild failed", err));
    return NextResponse.json(toWeekdayDefault(saved));
  } catch (e) {
    console.error("work-hours defaults PUT", e);
    return NextResponse.json({ error: "שמירת היום נכשלה" }, { status: 500 });
  }
}, { role: WH_ROLES });
