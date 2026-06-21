import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getCurrentUtcIso } from "@/app/lib/datetime";

export const runtime = "nodejs";

/**
 * API endpoint to start a test (update status from 2 "waiting" to 1 "in test")
 * Also sets processing_start_time to current UTC time
 * Updates test_stations.status to 1 for the selected station
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { itemId, stationId } = body;

    if (!itemId || !stationId) {
      return NextResponse.json(
        { error: "itemId and stationId are required" },
        { status: 400 }
      );
    }

    // Get current UTC time as ISO string, then convert to Date for PostgreSQL
    const currentUtcIso = getCurrentUtcIso();
    const currentUtcDate = new Date(currentUtcIso);

    const result = await prisma.$transaction(async (tx) => {
      // First, check if the station is a research station (is_research = true)
      const stationInfo = await tx.test_stations.findUnique({
        where: { test_station_id: stationId },
        select: { is_research: true },
      });

      if (!stationInfo) {
        throw new Error("STATION_NOT_FOUND");
      }

      const isResearchStation = stationInfo.is_research === true;

      // Determine the target status: 5 for research stations, 1 for normal stations
      const targetStatus = isResearchStation ? 5 : 1;

      // Check if item is waiting for research (status 4) or normal waiting (status 2)
      const existingRoute = await tx.item_routes.findFirst({
        where: {
          item_id: BigInt(itemId),
          current_status: { in: [2, 4] },
        },
        select: { route_number: true },
      });

      if (!existingRoute) {
        throw new Error("ITEM_NOT_FOUND_OR_NOT_WAITING");
      }

      const routeNumber = existingRoute.route_number;

      // 1. Update item_routes: status to targetStatus, set processing_start_time, update test_station_id
      const updateResult = await tx.$queryRaw<any[]>`
        UPDATE item_routes
        SET current_status = ${targetStatus},
            processing_start_time = ${currentUtcDate}::timestamp,
            test_station_id = ${stationId}
        WHERE item_id = ${BigInt(itemId)}
          AND route_number = ${routeNumber}
          AND (current_status = 2 OR current_status = 4)
        RETURNING item_id, current_status, processing_start_time, test_station_id
      `;

      if (!updateResult || updateResult.length === 0) {
        throw new Error("ITEM_NOT_FOUND_OR_NOT_WAITING");
      }

      // 2. Update test_stations.status to 1 for the selected station
      await tx.test_stations.update({
        where: { test_station_id: stationId },
        data: { status: 1 },
      });

      return updateResult[0];
    });

    // Normalize processing_start_time to UTC ISO string
    // item_id is returned as BigInt by Prisma ($queryRaw + PostgreSQL BIGINT),
    // which JSON.stringify cannot serialize — convert to string.
    const normalizedRow = {
      ...result,
      item_id: result.item_id?.toString(),
      processing_start_time: result.processing_start_time
        ? new Date(result.processing_start_time).toISOString()
        : null,
    };

    return NextResponse.json({
      ok: true,
      item: normalizedRow,
    });
  } catch (error: any) {
    if (error.message === "STATION_NOT_FOUND") {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }
    if (error.message === "ITEM_NOT_FOUND_OR_NOT_WAITING") {
      return NextResponse.json(
        { error: "Item not found or not in waiting status" },
        { status: 404 }
      );
    }
    console.error("Error starting test:", error);
    return NextResponse.json(
      { error: "Failed to start test" },
      { status: 500 }
    );
  }
}
