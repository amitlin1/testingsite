import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { DashboardKpis } from "@/types/dashboard";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

export const runtime = "nodejs";

export const GET = withAuth(async (req: Request) => {
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

    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (startDateObj > endDateObj) {
      return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
    }

    const kpis: DashboardKpis = await MetricsService.getKpiStatsFiltered(
      prisma,
      startDate,
      endDate,
      searchParams
    );

    return NextResponse.json(kpis);
  } catch (error) {
    console.error("Error fetching dashboard KPIs:", error);
    const defaultKpis: DashboardKpis = {
      averageQueueTimeMinutes: null,
      averageProcessingTimeMinutes: null,
      totalItemsProcessed: 0,
      itemsCurrentlyInQueue: 0,
      itemsCurrentlyInTest: 0,
      busiestStationId: null,
      busiestStationName: null,
      busiestStationCount: 0,
      busiestStationWorkloadScore: 0,
      busiestStationBusySeconds: 0,
      busiestStationWaitSeconds: 0,
    };
    return NextResponse.json(defaultKpis);
  }
}, { role: "manager" });
