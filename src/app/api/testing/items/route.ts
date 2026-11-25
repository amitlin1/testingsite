import { NextResponse } from "next/server";
import { listQueue } from "@/app/lib/testing/queue";
import { parseDbId } from "@/lib/http/request";

export const runtime = "nodejs";

/** GET /api/testing/items?stationId — the station's queue (lib/testing/queue.ts). */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const stationId = searchParams.get("stationId");
        if (!stationId) {
            return NextResponse.json({ error: "stationId is required" }, { status: 400 });
        }

        const stationIdNum = parseDbId(stationId);
        if (stationIdNum == null) {
            return NextResponse.json({ error: "Invalid stationId" }, { status: 400 });
        }

        return NextResponse.json(await listQueue(stationIdNum));
    } catch (error) {
        console.error("Error loading items by station:", error);
        return NextResponse.json([]);
    }
}
