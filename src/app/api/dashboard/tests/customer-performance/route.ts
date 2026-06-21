import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";
import type { CustomerPerformanceRow } from "@/types/dashboard";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const showAllHistory = searchParams.get("showAllHistory") === "true";

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    const itemSerial = searchParams.get("itemSerial");
    const itemTypeId = searchParams.get("itemTypeId");
    const shipmentId = searchParams.get("shipmentId");
    const testStationId = searchParams.get("testStationId");
    const testStationTypeId = searchParams.get("testStationTypeId");

    const stats = await MetricsService.getCustomerPerformance(
      prisma,
      startDate,
      endDate,
      {
        itemSerial: itemSerial || undefined,
        itemTypeId: itemTypeId ? parseInt(itemTypeId, 10) : undefined,
        shipmentId: shipmentId ? parseInt(shipmentId, 10) : undefined,
        testStationId: testStationId ? parseInt(testStationId, 10) : undefined,
        testStationTypeId: testStationTypeId ? parseInt(testStationTypeId, 10) : undefined,
        showAllHistory,
      }
    );

    const customers: CustomerPerformanceRow[] = stats.map((s) => ({
      customerId: s.customerId,
      customerCode: s.customerCode,
      customerName: s.customerName,
      totalItems: s.totalItems,
      itemsInQueue: s.itemsInQueue,
      itemsInTest: s.itemsInTest,
      itemsWaitingForResearch: s.itemsWaitingForResearch,
      itemsInResearch: s.itemsInResearch,
      finishedItems: s.finishedItems,
      itemsInRoutes: s.itemsInRoutes,
      successPercentage: s.successPercentage,
      itemsInRoutesPercentage: s.itemsInRoutesPercentage,
      averageTimeMinutes: s.averageTimeMinutes,
    }));

    return NextResponse.json(customers);
  } catch (error) {
    console.error("Error fetching customer performance data:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer performance data" },
      { status: 500 }
    );
  }
}
