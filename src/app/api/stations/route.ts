import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_stations.findMany({
      orderBy: { test_station_desc: "asc" },
    });

    // The station's name only — the internal id meant nothing to the workers
    // (the pickers show the station type under the name).
    const stations = rows.map((row) => ({
      id: row.test_station_id,
      name: (row.test_station_desc ?? "").trim(),
      typeId: row.test_station_type_id,
    }));

    return NextResponse.json(stations);
  } catch (error) {
    console.error("Error loading stations:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}
