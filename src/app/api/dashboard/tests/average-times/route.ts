import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildDashboardFilters } from "@/app/lib/dashboard-filters";

export const runtime = "nodejs";

export interface AverageTimesPoint {
  date: string;
  avgWaitingMinutes: number | null;
  avgProcessingMinutes: number | null;
  recordCount: number;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const period = searchParams.get("period") || "daily"; // daily, monthly, quarterly

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    const showAllHistory = searchParams.get("showAllHistory") === "true";

    // Build filter conditions using the shared utility
    const filterResult = buildDashboardFilters({
      searchParams,
      startIndex: 3, // $1 = startDate, $2 = endDate
      itemRef: "irh.item_id",
      stationRef: "irh.test_station_id",
      workerRef: "irh.worker_id",
      statusRef: null, // item_route_history doesn't have status
      showAllHistory,
    });

    // Determine date truncation based on period
    let dateTrunc = "day";
    if (period === "monthly") dateTrunc = "month";
    else if (period === "quarterly") dateTrunc = "quarter";

    // Main query to calculate average times from item_route_history
    const query = `
      WITH filtered_data AS (
        SELECT
          DATE_TRUNC('${dateTrunc}', irh.processing_end_time)::date as period_date,
          EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) as waiting_seconds,
          EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) as processing_seconds
        FROM item_route_history irh
        WHERE irh.processing_end_time >= $1::timestamp
          AND irh.processing_end_time < ($2::timestamp + interval '1 day')
          AND irh.processing_start_time IS NOT NULL
          AND irh.queue_start_time IS NOT NULL
          ${filterResult.conditions}
      )
      SELECT
        period_date as date,
        AVG(CASE WHEN waiting_seconds > 0 THEN waiting_seconds END) / 60 as avg_waiting_minutes,
        AVG(CASE WHEN processing_seconds > 0 THEN processing_seconds END) / 60 as avg_processing_minutes,
        COUNT(*) as record_count
      FROM filtered_data
      WHERE period_date IS NOT NULL
      GROUP BY period_date
      ORDER BY period_date ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, startDate, endDate, ...filterResult.params);

    // Also fetch today's live data if the date range includes today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const endDateObj = new Date(endDate);
    endDateObj.setHours(0, 0, 0, 0);

    const data: AverageTimesPoint[] = rows.map((row: any) => ({
      date: new Date(row.date).toISOString().split("T")[0],
      avgWaitingMinutes: row.avg_waiting_minutes
        ? parseFloat(row.avg_waiting_minutes)
        : null,
      avgProcessingMinutes: row.avg_processing_minutes
        ? parseFloat(row.avg_processing_minutes)
        : null,
      recordCount: parseInt(row.record_count, 10),
    }));

    // If today is within range and we're on daily view, add/update today's point with live indicator
    if (period === "daily" && endDateObj >= today) {
      const todayIndex = data.findIndex((d) => d.date === todayStr);
      if (todayIndex >= 0) {
        (data[todayIndex] as any).isToday = true;
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error fetching average times:", error);
    return NextResponse.json(
      { error: "Failed to fetch average times", details: error.message },
      { status: 500 }
    );
  }
}
