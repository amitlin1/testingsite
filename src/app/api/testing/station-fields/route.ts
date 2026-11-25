import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadStationFields } from "@/app/lib/station-fields/submit";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId, parseItemId } from "@/lib/http/request";

export const runtime = "nodejs";

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
    const itemId = parseItemId(itemIdRaw);
    if (itemId == null) return NextResponse.json({ error: "Invalid itemId" }, { status: 400 });
    const stationIdRaw = (searchParams.get("stationId") ?? "").trim();
    const stationId = stationIdRaw === "" ? null : parseDbId(stationIdRaw);
    if (stationIdRaw !== "" && stationId == null) return NextResponse.json({ error: "Invalid stationId" }, { status: 400 });

    return NextResponse.json(await loadStationFields(prisma, { itemId, stationId }));
  } catch (error) {
    return errorResponse(error, "Failed to load station fields");
  }
}
