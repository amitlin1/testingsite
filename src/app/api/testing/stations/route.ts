import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.test_stations_type.findMany({
      select: {
        test_station_type_id: true,
        test_type_desc: true,
        package_level: true,
      },
      orderBy: { test_type_desc: "asc" },
    });

    return NextResponse.json(
      rows.map((r) => ({
        id: r.test_station_type_id,
        name: r.test_type_desc.trim(),
        // Package-level station types (opening / closing) queue PACKAGES, not
        // items (docs/packages/PLAN.md §4).
        packageLevel: r.package_level,
      }))
    );
  } catch (error) {
    console.error("Error loading test station types:", error);
    return NextResponse.json([]);
  }
}
