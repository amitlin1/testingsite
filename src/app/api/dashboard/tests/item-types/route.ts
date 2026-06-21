import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ItemTypeTrackingRow } from "@/types/dashboard";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const itemTypes: ItemTypeTrackingRow[] =
      await MetricsService.getItemTypeStatsFiltered(prisma, searchParams);

    return NextResponse.json(itemTypes);
  } catch (error) {
    console.error("Error fetching item type tracking data:", error);
    return NextResponse.json(
      { error: "Failed to fetch item type tracking data" },
      { status: 500 }
    );
  }
}
