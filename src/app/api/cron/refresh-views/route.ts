import { NextResponse } from "next/server";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * POST /api/cron/refresh-views
 *
 * Refreshes materialized views concurrently.
 * Should be called every 10 minutes for near-real-time aggregation
 * without impacting live query performance.
 */
export async function POST() {
  try {
    await MetricsService.refreshMaterializedViews(prisma);

    return NextResponse.json({
      success: true,
      message: "Materialized views refreshed",
    });
  } catch (error: any) {
    console.error("Error refreshing materialized views:", error);
    return NextResponse.json(
      {
        error: "Failed to refresh materialized views",
        message: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
