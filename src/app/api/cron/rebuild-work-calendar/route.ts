import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { cronSecretGuard } from "@/lib/auth/cron-secret";
import { rebuildWorkCalendar } from "@/lib/work-calendar";

export const runtime = "nodejs";

/**
 * POST /api/cron/rebuild-work-calendar
 *
 * Regenerates the versioned work calendar (work_calendar_version + work_span)
 * over the rolling [-24 months, +12 months] horizon — plan §3.5/§7.4. Runs
 * nightly at 01:00 from the Windows Task Scheduler, and the same shared
 * function fires after every write on the work-hours settings screen.
 *
 * Thin shell by design: all logic — the single transaction (TEMP stage table
 * ON COMMIT DROP + work_calendar_build + is_current flip), the source-digest
 * no-op and the advisory-lock overlap skip — lives in
 * src/lib/work-calendar.ts. A healthy skip/no-op returns HTTP 200: the Task
 * Scheduler's curl --fail would paint any non-2xx as a job failure (§10.1).
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;

  try {
    const result = await rebuildWorkCalendar(prisma);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Error rebuilding work calendar:", error);
    return NextResponse.json(
      { error: "Failed to rebuild work calendar", message: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
