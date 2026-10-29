import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * Photo types — the global photo classifications ("package", "product", ...).
 *
 * Screens/pickers list these to tag reference images and worker-captured item
 * photos; code addresses a group by the stable `code`, never by the numeric id.
 * Active types only, unless `?all=1` — a test station keeps tagging its captures
 * with its group even after the type is hidden from the pickers.
 *
 * A group a popup template's photo component owns (docs/popup-templates/PLAN.md
 * §3.4) carries its station type: station_type_id / station_type_desc, so the
 * reference-items page can list it under its station. Both null = no owner.
 *
 * A group a route photo field owns (station-fields/photo-groups.ts) comes only
 * with `?all=1`, where screens name photos by their group: a photo field shows
 * no reference images, so the pickers never offer it.
 */
export async function GET(request: Request) {
  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    const rows = await prisma.photo_types.findMany({
      where: all ? {} : { is_active: true, test_route_id: null },
      orderBy: { sort_order: "asc" },
      select: {
        photo_type_id: true, code: true, photo_type_desc: true, sort_order: true,
        test_station_type_id: true, test_stations_type: { select: { test_type_desc: true } },
      },
    });
    return NextResponse.json(rows.map(({ test_station_type_id, test_stations_type, ...r }) => ({
      ...r,
      station_type_id: test_station_type_id,
      station_type_desc: test_stations_type?.test_type_desc.trim() ?? null,
    })));
  } catch (error) {
    console.error("Error fetching photo types:", error);
    // A real error, never an empty list (route-fields spec §11-12): every caller
    // already treats a non-ok answer as a failed load.
    return NextResponse.json({ error: "Failed to fetch photo types" }, { status: 500 });
  }
}
