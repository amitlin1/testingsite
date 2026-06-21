import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { StationLoadRow } from "@/types/dashboard";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/tests/stations/history
 *
 * מחזיר היסטוריה של תחנה מסוימת לאורך זמן
 *
 * Query params:
 * - stationId: מזהה התחנה (חובה)
 * - startDate: תאריך התחלה (YYYY-MM-DD)
 * - endDate: תאריך סיום (YYYY-MM-DD)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!stationId) {
      return NextResponse.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    // Determine which table to use based on date range
    const tableName = getSnapshotTableName(
      SNAPSHOT_TABLES.station,
      startDate,
      endDate
    );

    let query = `
      SELECT
        snapshot_date,
        station_id,
        station_name,
        station_type_name,
        items_in_queue,
        items_in_test,
        average_current_queue_time_minutes,
        total_processed_in_period,
        created_at
      FROM ${tableName}
      WHERE station_id = $1::int
        AND snapshot_date >= $2::date
        AND snapshot_date <= $3::date
      ORDER BY snapshot_date ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, parseInt(stationId, 10), startDate, endDate);

    const history: StationLoadRow[] = rows.map((row: any) => ({
      stationId: row.station_id,
      stationName: row.station_name || '',
      stationTypeName: row.station_type_name || null,
      itemsInQueue: Number(row.items_in_queue) || 0,
      itemsInTest: Number(row.items_in_test) || 0,
      averageCurrentQueueTimeMinutes: row.average_current_queue_time_minutes ? Number(row.average_current_queue_time_minutes) : null,
      totalProcessedInPeriod: Number(row.total_processed_in_period) || 0,
    }));

    return NextResponse.json({
      stationId: parseInt(stationId, 10),
      history,
      count: history.length
    });
  } catch (error: any) {
    console.error("Error fetching station history:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch station history",
        message: error.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
