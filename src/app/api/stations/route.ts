import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_stations.findMany({
      orderBy: { test_station_desc: "asc" },
    });

    // Format name to include ID as requested: "Name (ID)"
    const stations = rows.map((row) => ({
      id: row.test_station_id,
      name: `${(row.test_station_desc ?? "").trim()} (${row.test_station_id})`,
      typeId: row.test_station_type_id,
    }));

    return NextResponse.json(stations);
  } catch (error) {
    console.error("Error loading stations:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}
