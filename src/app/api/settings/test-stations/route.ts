import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fixSequence } from "@/app/lib/fix-sequence";
import { Prisma } from "@prisma/client";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const typeId = searchParams.get("typeId");

    const where: any = {};
    if (typeId) {
      where.test_station_type_id = parseInt(typeId, 10);
    }

    const rows = await prisma.test_stations.findMany({
      where,
      include: { test_stations_type: true },
      orderBy: { test_station_desc: "asc" },
    });

    // Attach live queue/test counts from station_live_counters
    // so Settings page shows the SAME numbers as Dashboard
    const liveCounters = await MetricsService.getStationLiveCounters(prisma);
    const countersMap = new Map(
      liveCounters.map((c) => [c.stationId, c])
    );

    const result = rows.map((r) => {
      const live = countersMap.get(r.test_station_id);
      return {
        test_station_id: r.test_station_id,
        test_station_type_id: r.test_station_type_id,
        test_station_desc: r.test_station_desc.trim(),
        status: r.status,
        is_research: r.is_research,
        test_type_desc: r.test_stations_type.test_type_desc.trim(),
        items_in_queue: live?.itemsInQueue ?? 0,
        items_in_test: live?.itemsInTest ?? 0,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching test stations:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { test_station_type_id, test_station_desc, status, is_research } = body;

  if (!test_station_type_id || !test_station_desc) {
    return NextResponse.json(
      { error: "Type and Description are required" },
      { status: 400 }
    );
  }

  const trimmedDesc = test_station_desc.trim();
  const finalStatus = status || 0;
  const finalIsResearch = is_research || false;

  // Fix sequence before insert
  await fixSequence(prisma, "test_stations", "test_station_id", "test_stations_test_station_id_seq");

  try {
    const created = await prisma.test_stations.create({
      data: {
        test_station_type_id,
        test_station_desc: trimmedDesc,
        status: finalStatus,
        is_research: finalIsResearch,
      },
    });

    return NextResponse.json({
      test_station_id: created.test_station_id,
      test_station_type_id: created.test_station_type_id,
      test_station_desc: created.test_station_desc.trim(),
      status: created.status,
      is_research: created.is_research,
    });
  } catch (error: any) {
    console.error("Error creating test station:", error);

    // If duplicate key, fix sequence and retry
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      try {
        console.log("Duplicate key detected, fixing sequence and retrying...");
        await fixSequence(prisma, "test_stations", "test_station_id", "test_stations_test_station_id_seq");
        const retryCreated = await prisma.test_stations.create({
          data: {
            test_station_type_id,
            test_station_desc: trimmedDesc,
            status: finalStatus,
            is_research: finalIsResearch,
          },
        });
        return NextResponse.json({
          test_station_id: retryCreated.test_station_id,
          test_station_type_id: retryCreated.test_station_type_id,
          test_station_desc: retryCreated.test_station_desc.trim(),
          status: retryCreated.status,
          is_research: retryCreated.is_research,
        });
      } catch (retryError: any) {
        console.error("Retry after sequence fix failed:", retryError);
        return NextResponse.json(
          { error: "שגיאה ביצירת עמדה. נא לנסות שוב." },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { error: error.message || "Failed to create test station" },
      { status: 500 }
    );
  }
}
