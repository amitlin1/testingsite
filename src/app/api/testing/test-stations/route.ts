import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const typeId = searchParams.get("typeId");

    if (!typeId) {
      return NextResponse.json(
        { error: "typeId query parameter is required" },
        { status: 400 }
      );
    }

    const typeIdNumber = Number(typeId);
    if (Number.isNaN(typeIdNumber)) {
      return NextResponse.json(
        { error: "typeId must be a number" },
        { status: 400 }
      );
    }

    const rows = await prisma.test_stations.findMany({
      where: { test_station_type_id: typeIdNumber },
      select: {
        test_station_id: true,
        test_station_desc: true,
        test_station_type_id: true,
        status: true,
        is_research: true,
      },
      orderBy: { test_station_desc: "asc" },
    });

    return NextResponse.json(
      rows.map((r) => ({
        id: r.test_station_id,
        name: r.test_station_desc.trim(),
        typeId: r.test_station_type_id,
        status: r.status,
        isResearch: r.is_research,
      }))
    );
  } catch (error) {
    console.error("Error loading test stations:", error);
    return NextResponse.json([]);
  }
}
