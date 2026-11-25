import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { TestStationType } from "@/app/lib/testing/contract";

export const runtime = "nodejs";

/** GET /api/testing/stations — every station type, with what decides its popup. */
export async function GET() {
  try {
    const rows = await prisma.test_stations_type.findMany({
      select: {
        test_station_type_id: true,
        test_type_desc: true,
        package_level: true,
        popup_template: { select: { base: true, version: true } },
      },
      orderBy: { test_type_desc: "asc" },
    });

    return NextResponse.json(
      rows.map((r): TestStationType => ({
        id: r.test_station_type_id,
        name: r.test_type_desc.trim(),
        packageLevel: r.package_level,
        popupTemplate: r.popup_template ? { base: r.popup_template.base, version: r.popup_template.version } : null,
      }))
    );
  } catch (error) {
    console.error("Error loading test station types:", error);
    return NextResponse.json([]);
  }
}
