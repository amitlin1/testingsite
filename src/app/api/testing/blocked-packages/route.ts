import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { loadPackages } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * GET /api/testing/blocked-packages?stationId — the boxes that are NOT in
 * this closing station's queue yet because some of their items are still
 * elsewhere (status 6, docs/packages/PLAN.md §4). The testing screen shows
 * them in the amber "ממתין לפריטי המארז" banner above the queue, with each
 * missing item and where it is. Empty for stations that are not
 * package-level.
 */
export async function GET(req: Request) {
  try {
    const stationId = Number(new URL(req.url).searchParams.get("stationId"));
    if (!Number.isFinite(stationId)) return NextResponse.json({ error: "stationId is required" }, { status: 400 });

    const station = await prisma.test_stations.findUnique({
      where: { test_station_id: stationId },
      select: { test_station_type_id: true, test_stations_type: { select: { package_level: true } } },
    });
    if (!station?.test_stations_type?.package_level) return NextResponse.json([]);

    const waiting = await loadPackages({ status: "waitItems" });
    return NextResponse.json(waiting.filter((p) => p.current_step_type_id === station.test_station_type_id));
  } catch (error) {
    console.error("Error loading blocked packages:", error);
    return NextResponse.json([]);
  }
}
