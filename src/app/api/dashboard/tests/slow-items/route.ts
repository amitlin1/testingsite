import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { SlowItemRow } from "@/types/dashboard";
import { buildDashboardFilters } from "@/app/lib/dashboard-filters";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const showAllHistory = searchParams.get("showAllHistory") === "true";

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    const filters = buildDashboardFilters({
      searchParams,
      startIndex: 3,
      itemRef: "irh.item_id",
      stationRef: "irh.test_station_id",
      workerRef: "irh.worker_id",
      statusRef: null,
      showAllHistory,
    });

    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (startDateObj > endDateObj) {
      return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
    }

    if (limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: "limit must be between 1 and 100" },
        { status: 400 }
      );
    }

    const limitParamIndex = filters.nextIndex;

    const queryParams = [startDate, endDate, ...filters.params, limit];

    const query = `
      SELECT
        irh.item_id AS "itemId",
        i.serial_no AS "serialNo",
        i.makat,
        i.model,
        TRIM(ts.test_station_desc) AS station_name,
        irh.current_route_step AS "routeStep",
        EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60.0 AS queue_minutes,
        EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) / 60.0 AS processing_minutes,
        EXTRACT(EPOCH FROM (irh.processing_end_time - irh.queue_start_time)) / 60.0 AS total_minutes,
        irh.worker_id AS "workerId"
      FROM item_route_history irh
      INNER JOIN items i ON i.item_id = irh.item_id
      LEFT JOIN test_stations ts ON ts.test_station_id = irh.test_station_id
      WHERE irh.processing_end_time IS NOT NULL
        AND irh.processing_start_time IS NOT NULL
        AND irh.queue_start_time IS NOT NULL
        AND irh.processing_end_time >= $1::timestamp
        AND irh.processing_end_time <= $2::timestamp
        ${filters.conditions}
      ORDER BY total_minutes DESC NULLS LAST
      LIMIT $${limitParamIndex}
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);

    const slowItems: SlowItemRow[] = rows.map((row: any) => ({
      itemId: row.itemId,
      serialNo: row.serialNo,
      makat: row.makat,
      model: row.model,
      stationName: row.station_name,
      routeStep: row.routeStep,
      queueTimeMinutes: row.queue_minutes ?? null,
      processingTimeMinutes: row.processing_minutes ?? null,
      totalTimeMinutes: row.total_minutes ?? null,
      workerId: row.workerId ?? null,
    }));

    return NextResponse.json(slowItems);
  } catch (error) {
    console.error("Error fetching slow items:", error);
    return NextResponse.json([]);
  }
}
