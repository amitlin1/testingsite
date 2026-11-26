import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ensureWorkCalendar } from "@/app/lib/metrics/ledger/calendar-sync";
import type { WorkWindowsWire } from "@/app/lib/dashboard/work-clock";

export const runtime = "nodejs";

/**
 * GET /api/work-clock/windows — the working-hours windows of the current work
 * calendar, from its first day to tomorrow, as epoch-ms pairs. The testing
 * screen counts its live timers in net time from them (testing/clock.ts): the
 * same windows work_seconds_between reads, so a timer there agrees with the
 * dashboard. About 1,000 windows (two years back). Open to every signed-in user.
 */
export const GET = withAuth(async () => {
  try {
    await ensureWorkCalendar();
    const rows = await prisma.$queryRaw<{ s: number; e: number }[]>`
      SELECT (EXTRACT(EPOCH FROM lower(span)) * 1000)::float8 AS s,
             (EXTRACT(EPOCH FROM upper(span)) * 1000)::float8 AS e
        FROM work_span
       WHERE calendar_version = current_calendar_version()
         AND work_date <= business_date(now()) + 1
       ORDER BY lower(span)`;
    const [{ built }] = await prisma.$queryRaw<{ built: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM work_calendar_version WHERE is_current) AS built`;
    const body: WorkWindowsWire = { built, windows: rows.flatMap((r) => [Number(r.s), Number(r.e)]) };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("work-clock windows", error);
    return NextResponse.json({ error: "שגיאה בטעינת שעות העבודה" }, { status: 500 });
  }
});
