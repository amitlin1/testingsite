import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { cronSecretGuard } from "@/lib/auth/cron-secret";

export const runtime = "nodejs";

const STALE_MINUTES = 30;

/**
 * POST /api/cron/release-stale-tests
 *
 * Safety net for the in-test lock: opening a test dialog calls
 * /api/testing/start-test, which locks the item into "in test" (1) / "in
 * research" (5), and the dialog's onClose releases it back to waiting when
 * closed without a submitted result. That release never fires if the worker
 * abandons the tab outright (closed laptop, crash, lost connection) — the
 * item, and its physical test station, would stay locked forever. Run this
 * every few minutes to revert anything that's been sitting in-test/in-research
 * past STALE_MINUTES with no result recorded.
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;

  try {
    const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

    const released = await prisma.$queryRaw<{ item_id: bigint; test_station_id: number | null }[]>`
      UPDATE item_routes
      SET current_status = CASE WHEN current_status = 5 THEN 4 ELSE 2 END,
          processing_start_time = NULL,
          queue_start_time = NOW()
      WHERE current_status IN (1, 5)
        AND processing_start_time IS NOT NULL
        AND processing_start_time < ${cutoff}::timestamp
        AND finished_at IS NULL
      RETURNING item_id, test_station_id
    `;

    const stationIds = [...new Set(released.map((r) => r.test_station_id).filter((id): id is number => id != null))];
    await Promise.all(
      stationIds.map((stationId) =>
        prisma.test_stations.update({ where: { test_station_id: stationId }, data: { status: 2 } })
      )
    );

    return NextResponse.json({
      success: true,
      releasedCount: released.length,
      itemIds: released.map((r) => r.item_id.toString()),
    });
  } catch (error: any) {
    console.error("Error releasing stale tests:", error);
    return NextResponse.json(
      { error: "Failed to release stale tests", message: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
