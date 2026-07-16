import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * Count of tests completed at a station since a given moment (start of the
 * local day, computed by the client). A "completed test" is an
 * item_route_history row for this station with processing_end_time set —
 * exactly what the results endpoint writes when a test is finished.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const stationId = searchParams.get("stationId");
    const since = searchParams.get("since");

    if (!stationId) {
      return NextResponse.json({ error: "stationId is required" }, { status: 400 });
    }
    const stationIdNum = Number(stationId);
    if (isNaN(stationIdNum)) {
      return NextResponse.json({ error: "Invalid stationId" }, { status: 400 });
    }

    const sinceDate = since ? new Date(since) : null;
    if (!sinceDate || isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "since (ISO timestamp) is required" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT COUNT(*) AS count
      FROM item_route_history
      WHERE test_station_id = ${stationIdNum}
        AND processing_end_time IS NOT NULL
        AND processing_end_time >= ${sinceDate}::timestamp
    `;

    const count = rows[0]?.count != null ? Number(rows[0].count) : 0;
    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error loading completed-today count:", error);
    return NextResponse.json({ count: 0 });
  }
}
