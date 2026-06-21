import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { DashboardKpis } from "@/types/dashboard";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/tests/kpis/history
 *
 * מחזיר היסטוריה של KPIs לאורך זמן
 *
 * Query params:
 * - startDate: תאריך התחלה (YYYY-MM-DD)
 * - endDate: תאריך סיום (YYYY-MM-DD)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    // Determine which table to use based on date range
    const tableName = getSnapshotTableName(
      SNAPSHOT_TABLES.kpi,
      startDate,
      endDate
    );

    let query = `
      SELECT
        snapshot_date,
        average_queue_time_minutes,
        average_processing_time_minutes,
        total_items_processed,
        items_currently_in_queue,
        items_currently_in_test,
        busiest_station_id,
        busiest_station_name,
        busiest_station_count,
        created_at
      FROM ${tableName}
      WHERE snapshot_date >= $1::date
        AND snapshot_date <= $2::date
      ORDER BY snapshot_date ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, startDate, endDate);

    const history: (DashboardKpis & { date: string })[] = rows.map((row: any) => ({
      date: row.snapshot_date.toISOString().split('T')[0],
      averageQueueTimeMinutes: row.average_queue_time_minutes ? Number(row.average_queue_time_minutes) : null,
      averageProcessingTimeMinutes: row.average_processing_time_minutes ? Number(row.average_processing_time_minutes) : null,
      totalItemsProcessed: Number(row.total_items_processed) || 0,
      itemsCurrentlyInQueue: Number(row.items_currently_in_queue) || 0,
      itemsCurrentlyInTest: Number(row.items_currently_in_test) || 0,
      busiestStationId: row.busiest_station_id || null,
      busiestStationName: row.busiest_station_name || null,
      busiestStationCount: Number(row.busiest_station_count) || 0,
    }));

    return NextResponse.json({
      history,
      count: history.length
    });
  } catch (error: any) {
    console.error("Error fetching KPIs history:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch KPIs history",
        message: error.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
