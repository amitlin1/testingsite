import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { StationFieldsNotFoundError, loadStationFields } from "@/app/lib/station-fields/submit";

export const runtime = "nodejs";

/** item_routes.item_id is a BIGINT. */
const INT8_MAX = BigInt("9223372036854775807");

/**
 * GET /api/testing/station-fields?itemId=&stationId= — the fields the popup opening on this row
 * shows at its current step (route-fields spec §3.3): { mode: "legacy" } for today's popup,
 * "item" for a per-item step, "package" for a kit row at a package-level step.
 *
 * No withAuth: like every /api/testing handler, it is gated by the middleware's role rule
 * (src/lib/routes.ts). stationId, when given, is the popup's station — a research station is
 * always "legacy". A failure is a real error, never a "legacy" answer: the popup blocks on an
 * error instead of saving a result without the fields it should carry (spec §4.2).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemIdRaw = (searchParams.get("itemId") ?? "").trim();
    if (itemIdRaw === "") return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    const itemId = /^\d{1,19}$/.test(itemIdRaw) ? BigInt(itemIdRaw) : null;
    if (itemId == null || itemId < BigInt(1) || itemId > INT8_MAX) {
      return NextResponse.json({ error: "Invalid itemId" }, { status: 400 });
    }
    const stationIdRaw = (searchParams.get("stationId") ?? "").trim();
    let stationId: number | null = null;
    if (stationIdRaw !== "") {
      stationId = /^\d{1,10}$/.test(stationIdRaw) ? Number(stationIdRaw) : NaN;
      if (!(stationId >= 1 && stationId <= 2147483647)) {
        return NextResponse.json({ error: "Invalid stationId" }, { status: 400 });
      }
    }

    return NextResponse.json(await loadStationFields(prisma, { itemId, stationId }));
  } catch (error) {
    if (error instanceof StationFieldsNotFoundError) {
      return NextResponse.json({ error: "Item route not found", code: error.code }, { status: 404 });
    }
    console.error("Error loading station fields:", error);
    return NextResponse.json({ error: "Failed to load station fields" }, { status: 500 });
  }
}
