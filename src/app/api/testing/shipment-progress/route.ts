import { NextResponse } from "next/server";
import { shipmentProgress } from "@/app/lib/testing/shipment-progress";
import { parseDbId } from "@/lib/http/request";

export const runtime = "nodejs";

/** A queue holds a few dozen shipments; more than this is not a screen's question. */
const MAX_SHIPMENTS = 300;

/**
 * GET /api/testing/shipment-progress?stationId=&shipmentIds=1,2,3 — the testing screen's tree: per
 * shipment in the station's queue, how many of its rows pass this station's type and how many are
 * already past it (lib/testing/shipment-progress.ts).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stationId = parseDbId(searchParams.get("stationId"));
  if (stationId == null) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }
  const raw = (searchParams.get("shipmentIds") ?? "").split(",").filter((s) => s.trim() !== "");
  const shipmentIds = [...new Set(raw.map(parseDbId))];
  if (shipmentIds.some((id) => id == null) || shipmentIds.length > MAX_SHIPMENTS) {
    return NextResponse.json({ error: "Invalid shipmentIds" }, { status: 400 });
  }

  try {
    return NextResponse.json(await shipmentProgress(stationId, shipmentIds as number[]));
  } catch (error) {
    console.error("Error loading shipment progress:", error);
    return NextResponse.json({ error: "Failed to load shipment progress" }, { status: 500 });
  }
}
