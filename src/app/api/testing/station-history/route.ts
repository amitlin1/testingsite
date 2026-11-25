import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseDbId } from "@/lib/http/request";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import type { StationHistoryRow } from "@/app/lib/testing/contract";

export const runtime = "nodejs";

/** GET /api/testing/station-history?stationId — the station's last 100 results, newest first. */
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

    const stationIdNum = parseDbId(stationId);
    if (stationIdNum == null) {
      return NextResponse.json(
        { error: "Invalid stationId" },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<{
      logId: number | bigint;
      itemId: bigint;
      currentRouteStep: number;
      testStationId: number;
      queueStartTime: Date | null;
      processingStartTime: Date | null;
      processingEndTime: Date | null;
      workerId: number | null;
      serialNo: string | null;
      makat: string;
      model: string;
      manufacturerName: string;
      manufacturerNo: string;
      itemTypeDesc: string | null;
    }[]>`
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

    const normalizedRows = rows.map((row): StationHistoryRow => ({
      ...row,
      logId: Number(row.logId),
      itemId: Number(row.itemId),
      currentRouteStep: Number(row.currentRouteStep),
      testStationId: Number(row.testStationId),
      workerId: row.workerId !== null ? Number(row.workerId) : null,
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
