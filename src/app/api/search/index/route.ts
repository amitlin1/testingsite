import { prisma } from "@/app/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Static half of the command-palette search index.
//
// Stations, station types and item types are small, bounded tables (tens to a
// few hundred rows), so the palette fetches them ONCE when it opens and ranks
// them client-side — that's what makes typing an עמדה name feel instant, with
// no round-trip per keystroke.
//
// Items are deliberately NOT here: that table is unbounded and /api/items
// already returns every row with no WHERE clause. Item search goes through
// /api/search/items instead, which filters in the database and caps the result.

export interface SearchStation {
  id: number;
  desc: string;
  typeId: number;
  typeDesc: string;
  status: number;
  /**
   * Human label for `status` (1 "עבודה", 2 "המתנה", 3 "לא פעילה"). Resolved
   * here because `test_stations.status` has no FK to `test_station_status` —
   * assuming "anything but 1 is inactive" mislabels a station in המתנה.
   */
  statusDesc: string;
  isResearch: boolean;
}

export interface SearchStationType {
  id: number;
  desc: string;
  parentsOnly: boolean;
  stationCount: number;
}

export interface SearchItemType {
  id: number;
  desc: string;
}

export interface SearchIndex {
  stations: SearchStation[];
  stationTypes: SearchStationType[];
  itemTypes: SearchItemType[];
}

const EMPTY: SearchIndex = { stations: [], stationTypes: [], itemTypes: [] };

export async function GET() {
  try {
    const [stations, types, itemTypes, statuses] = await Promise.all([
      prisma.test_stations.findMany({
        orderBy: { test_station_desc: "asc" },
        include: { test_stations_type: { select: { test_type_desc: true } } },
      }),
      prisma.test_stations_type.findMany({
        orderBy: { test_type_desc: "asc" },
        include: { _count: { select: { test_stations: true } } },
      }),
      prisma.item_types.findMany({ orderBy: { item_type_desc: "asc" } }),
      prisma.test_station_status.findMany(),
    ]);

    const statusById = new Map(
      statuses.map((s) => [s.test_station_status_id, (s.test_station_status_desc ?? "").trim()]),
    );

    // `test_station_desc` / `test_type_desc` / `item_type_desc` are CHAR(50) —
    // Postgres pads them with trailing spaces, which would break both the
    // display and the substring matching. Trim at the boundary, once.
    const payload: SearchIndex = {
      stations: stations.map((s) => ({
        id: s.test_station_id,
        desc: (s.test_station_desc ?? "").trim(),
        typeId: s.test_station_type_id,
        typeDesc: (s.test_stations_type?.test_type_desc ?? "").trim(),
        status: s.status,
        statusDesc: statusById.get(s.status) ?? "",
        isResearch: s.is_research,
      })),
      stationTypes: types.map((t) => ({
        id: t.test_station_type_id,
        desc: (t.test_type_desc ?? "").trim(),
        parentsOnly: t.parents_only,
        stationCount: t._count.test_stations,
      })),
      itemTypes: itemTypes.map((t) => ({
        id: t.item_type_id,
        desc: (t.item_type_desc ?? "").trim(),
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Error loading search index:", error);
    // Degrade to an empty index rather than breaking the palette — item search
    // still works, and the quick-nav rows are client-side constants.
    return NextResponse.json(EMPTY);
  }
}
