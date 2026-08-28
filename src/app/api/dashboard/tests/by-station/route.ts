import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";
import type { StationLoadRow } from "@/types/dashboard";

export const runtime = "nodejs";

export const GET = withAuth(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const status = searchParams.get("status");
    const showAllHistory = searchParams.get("showAllHistory") === "true";

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    const customerId = searchParams.get("customerId");
    const shipmentId = searchParams.get("shipmentId");
    const itemSerial = searchParams.get("itemSerial");
    const itemTypeId = searchParams.get("itemTypeId");
    const testStationId = searchParams.get("testStationId");
    const testStationTypeId = searchParams.get("testStationTypeId");
    const workerId = searchParams.get("workerId");

    const stats = await MetricsService.getStationStats(
      prisma,
      startDate,
      endDate,
      {
        stationId: testStationId ? parseInt(testStationId, 10) : undefined,
        stationTypeId: testStationTypeId ? parseInt(testStationTypeId, 10) : undefined,
        customerId: customerId ? parseInt(customerId, 10) : undefined,
        shipmentId: shipmentId ? parseInt(shipmentId, 10) : undefined,
        itemSerial: itemSerial || undefined,
        itemTypeId: itemTypeId ? parseInt(itemTypeId, 10) : undefined,
        workerId: workerId && !isNaN(Number(workerId)) ? parseInt(workerId, 10) : undefined,
        showAllHistory,
      }
    );

    const showQueue = !status || status === "all" || status === "queue";
    const showTest = !status || status === "all" || status === "processing";

    const stations: StationLoadRow[] = stats.map((s) => ({
      stationId: s.stationId,
      stationName: s.stationName,
      stationTypeName: s.stationTypeName,
      itemsInQueue: showQueue ? s.itemsInQueue : 0,
      itemsInTest: showTest ? s.itemsInTest : 0,
      averageCurrentQueueTimeMinutes: s.averageCurrentQueueTimeMinutes,
      totalProcessedInPeriod: s.totalProcessedInPeriod,
    }));

    return NextResponse.json(stations);
  } catch (error) {
    console.error("Error fetching station load data:", error);
    return NextResponse.json([]);
  }
}, { role: "manager" });
