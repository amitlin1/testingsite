import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { StatusDistribution } from "@/types/dashboard";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

export const runtime = "nodejs";

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

    const distribution: StatusDistribution[] =
      await MetricsService.getStatusDistributionFiltered(
        prisma,
        startDate,
        endDate,
        searchParams
      );

    return NextResponse.json(distribution);
  } catch (error) {
    console.error("Error fetching status distribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch status distribution" },
      { status: 500 }
    );
  }
}
