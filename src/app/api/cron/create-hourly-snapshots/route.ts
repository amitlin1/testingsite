import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

import { cronSecretGuard } from "@/lib/auth/cron-secret";

export const runtime = "nodejs";

/**
 * POST /api/cron/create-hourly-snapshots
 *
 * Creates hourly station snapshots for granular station load analysis.
 * Should run at minute 59 of every hour (or at the top of each hour for the previous hour).
 *
 * Aggregates item_route_history for the last hour window per station,
 * capturing throughput and average queue/test times.
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;
  try {
    // Snapshot the hour that just ended (truncate current time to the hour)
    const now = new Date();
    const snapshotHour = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        0,
        0,
        0
      )
    );
    const hourStart = snapshotHour.toISOString();
    const hourEnd = new Date(snapshotHour.getTime() + 60 * 60 * 1000).toISOString();

    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO station_hourly_snapshots (snapshot_hour, station_id, items_processed, avg_queue_time, avg_test_time)
       SELECT
         $1::timestamp AS snapshot_hour,
         irh.test_station_id AS station_id,
         COUNT(*) AS items_processed,
         AVG(
           CASE WHEN irh.queue_start_time IS NOT NULL AND irh.processing_start_time IS NOT NULL
           THEN EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60.0
           ELSE NULL END
         ) AS avg_queue_time,
         AVG(
           CASE WHEN irh.processing_start_time IS NOT NULL AND irh.processing_end_time IS NOT NULL
           THEN EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) / 60.0
           ELSE NULL END
         ) AS avg_test_time
       FROM item_route_history irh
       WHERE irh.processing_end_time >= $2::timestamp
         AND irh.processing_end_time < $3::timestamp
       GROUP BY irh.test_station_id
       ON CONFLICT (snapshot_hour, station_id) DO UPDATE SET
         items_processed = EXCLUDED.items_processed,
         avg_queue_time = EXCLUDED.avg_queue_time,
         avg_test_time = EXCLUDED.avg_test_time`,
      hourStart,
      hourStart,
      hourEnd
    );

    // Also refresh the materialized view while we're here
    try {
      await prisma.$executeRawUnsafe(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_station_stats`
      );
    } catch {
      console.warn("Could not refresh mv_station_stats during hourly snapshot");
    }

    return NextResponse.json({
      success: true,
      snapshotHour: hourStart,
      message: "Hourly station snapshots created",
      stationsProcessed: result,
    });
  } catch (error: any) {
    console.error("Error creating hourly snapshots:", error);
    return NextResponse.json(
      {
        error: "Failed to create hourly snapshots",
        message: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
