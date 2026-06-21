import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";

export const runtime = "nodejs";

/**
 * API endpoint to fetch test history for a specific station
 * Returns history from item_route_history filtered by test_station_id
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");

    if (!stationId) {
      return NextResponse.json(
        { error: "stationId is required" },
        { status: 400 }
      );
    }

    const stationIdNum = Number(stationId);
    if (isNaN(stationIdNum)) {
      return NextResponse.json(
        { error: "Invalid stationId" },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        irh.log_id AS "logId",
        irh.item_id AS "itemId",
        irh.current_route_step AS "currentRouteStep",
        irh.test_station_id AS "testStationId",
        irh.queue_start_time AS "queueStartTime",
        irh.processing_start_time AS "processingStartTime",
        irh.processing_end_time AS "processingEndTime",
        irh.worker_id AS "workerId",
        i.serial_no AS "serialNo",
        i.makat,
        i.model,
        i.manufacturer_name AS "manufacturerName",
        i.manufacturer_no AS "manufacturerNo",
        TRIM(it.item_type_desc) AS "itemTypeDesc"
      FROM item_route_history irh
      INNER JOIN items i ON i.item_id = irh.item_id
      LEFT JOIN item_types it ON it.item_type_id = i.item_type_id
      WHERE irh.test_station_id = ${stationIdNum}
      ORDER BY
        COALESCE(irh.processing_end_time, irh.processing_start_time, irh.queue_start_time) DESC
      LIMIT 100
    `;

    const normalizedRows = rows.map((row: any) => ({
      ...row,
      queueStartTime: normalizeToUtcIso(row.queueStartTime),
      processingStartTime: normalizeToUtcIso(row.processingStartTime),
      processingEndTime: normalizeToUtcIso(row.processingEndTime),
    }));

    return NextResponse.json(normalizedRows);
  } catch (error) {
    console.error("Error loading station history:", error);
    return NextResponse.json([]);
  }
}
