import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * API endpoint to release a test that was started but abandoned before a
 * result was submitted (dialog closed / cancelled). Reverses start-test:
 * status 1 → 2 (waiting), 5 → 4 (waiting for research). No-ops if the item
 * already moved on (e.g. a result was submitted in the same moment the
 * client sent this), since the WHERE only matches the in-test/in-research row.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { itemId, stationId } = body;

    if (!itemId || !stationId) {
      return NextResponse.json(
        { error: "itemId and stationId are required" },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const stationInfo = await tx.test_stations.findUnique({
        where: { test_station_id: stationId },
        select: { is_research: true },
      });
      if (!stationInfo) throw new Error("STATION_NOT_FOUND");

      const fromStatus = stationInfo.is_research === true ? 5 : 1;
      const toStatus = stationInfo.is_research === true ? 4 : 2;

      const released = await tx.$executeRaw`
        UPDATE item_routes
        SET current_status = ${toStatus},
            processing_start_time = NULL,
            queue_start_time = NOW()
        WHERE item_id = ${BigInt(itemId)}
          AND current_status = ${fromStatus}
      `;

      if (released > 0) {
        await tx.test_stations.update({
          where: { test_station_id: stationId },
          data: { status: 2 },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error.message === "STATION_NOT_FOUND") {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    console.error("Error releasing test:", error);
    return NextResponse.json({ error: "Failed to release test" }, { status: 500 });
  }
}
