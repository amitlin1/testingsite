import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_stations_type.findMany({
      orderBy: { test_station_type_id: "asc" },
    });

    const result = rows.map((r) => ({
      id: r.test_station_type_id,
      name: r.test_type_desc.trim(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching test station types:", error);
    return NextResponse.json([]);
  }
}
