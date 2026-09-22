import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { computePackageGate } from "@/app/lib/packages/readiness";

export const runtime = "nodejs";

/**
 * GET /api/testing/locate-by-barcode?barcode=<barcode>
 *
 * Parses an item barcode (format: "itemId" or "itemId-sourceId") and returns
 * the test station the item is currently at (or waiting for), so the testing
 * page can auto-select that station and hoist the item to the top of the list.
 *
 * Status semantics:
 *   1 = InTest          → has test_station_id (use it directly)
 *   2 = InQueue         → station_type = route_steps[current_route_step]; pick any station of that type
 *   3 = Finished        → no active station, return 404
 *   4 = WaitingResearch → pick any research station
 *   5 = InResearch      → has test_station_id (use it directly)
 *   6 = WaitingForPackageItems → the box is held before closing; says which items are out
 *
 * Labels printed before the package-model upgrade carry the item's OLD id.
 * The upgrade keeps the old→new mapping in `legacy_id_map`
 * (scripts/prod-package-model); when the scanned id is unknown but maps to a
 * converted item, the lookup is answered for the new id and the payload adds
 * `legacyId` / `resolvedItemId`, so the screen can tell the worker the box
 * still wears its old label. The table exists only where the upgrade ran, so
 * it is probed before it is read.
 */
type Located = { status: number; body: Record<string, unknown> };

async function resolveLegacyId(legacyId: bigint): Promise<bigint | null> {
    const probe = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public.legacy_id_map') IS NOT NULL AS ok`;
    if (!probe[0]?.ok) return null;
    const rows = await prisma.$queryRaw<{ new_id: bigint | number | null }[]>`
        SELECT new_id FROM legacy_id_map WHERE legacy_id = ${legacyId} ORDER BY converted_at DESC LIMIT 1
    `;
    const v = rows[0]?.new_id;
    return v == null ? null : BigInt(v);
}

async function locate(itemIdBig: bigint): Promise<Located> {
    const rows = await prisma.$queryRaw<any[]>`
        SELECT
            ir.item_id              AS "itemId",
            ir.current_status       AS "currentStatus",
            ir.current_route_step   AS "currentRouteStep",
            ir.test_station_id      AS "testStationId",
            ir.is_finished          AS "isFinished",
            ir.finished_at          AS "finishedAt",
            tr.route_steps          AS "routeSteps",
            i.serial_no             AS "serialNo",
            i.makat                 AS "makat",
            i.model                 AS "model"
        FROM item_routes ir
        INNER JOIN items i
            ON i.item_id = ir.item_id
        LEFT JOIN testing_routes tr
            ON tr.item_type_id = ir.item_type_id
           AND tr.route_number = ir.route_number
        WHERE ir.item_id = ${itemIdBig}
        ORDER BY ir.item_id DESC
        LIMIT 1
    `;

    if (!rows.length) {
        return { status: 404, body: { error: "פריט לא נמצא", notFound: true } };
    }

    const row = rows[0];
    const currentStatus = Number(row.currentStatus);
    const currentRouteStep = Number(row.currentRouteStep);
    const routeSteps: number[] = Array.isArray(row.routeSteps) ? row.routeSteps : [];

    if (row.isFinished || currentStatus === 3) {
        // Not an error — a structured "finished" payload so the client can show
        // a friendly dialog instead of a red error toast.
        return {
            status: 200,
            body: {
                finished: true,
                itemId: Number(row.itemId),
                serialNo: row.serialNo,
                makat: row.makat ?? null,
                model: row.model,
            },
        };
    }

    if (currentStatus === 6) {
        // A package waiting for its items before the closing station
        // (docs/packages/PLAN.md §4). Not an error: tell the client which
        // items are still out so it can say so instead of "no station".
        const gate = await computePackageGate(prisma, itemIdBig);
        return {
            status: 200,
            body: {
                waitingForPackageItems: true,
                itemId: Number(row.itemId),
                currentStatus,
                serialNo: row.serialNo,
                makat: row.makat ?? null,
                model: row.model,
                stationTypeId: gate.stepTypeId,
                blockingItemIds: gate.blockingItemIds.map((b) => Number(b)),
            },
        };
    }

    // Resolve target station + station type.
    let stationId: number | null = null;
    let stationTypeId: number | null = null;

    if ((currentStatus === 1 || currentStatus === 5) && row.testStationId != null) {
        // In-test / in-research: the station is known.
        stationId = Number(row.testStationId);
        const station = await prisma.test_stations.findUnique({
            where: { test_station_id: stationId },
            select: { test_station_type_id: true },
        });
        stationTypeId = station?.test_station_type_id ?? null;
    } else if (currentStatus === 2) {
        // Queued for the next station type in the route.
        if (currentRouteStep >= 1 && currentRouteStep <= routeSteps.length) {
            stationTypeId = Number(routeSteps[currentRouteStep - 1]);
        }
        if (stationTypeId != null) {
            const station = await prisma.test_stations.findFirst({
                where: { test_station_type_id: stationTypeId, is_research: false },
                orderBy: { test_station_desc: "asc" },
                select: { test_station_id: true },
            });
            stationId = station?.test_station_id ?? null;
        }
    } else if (currentStatus === 4) {
        // Waiting for research: pick any research station.
        const station = await prisma.test_stations.findFirst({
            where: { is_research: true },
            orderBy: { test_station_desc: "asc" },
            select: { test_station_id: true, test_station_type_id: true },
        });
        stationId = station?.test_station_id ?? null;
        stationTypeId = station?.test_station_type_id ?? null;
    }

    if (stationId == null || stationTypeId == null) {
        return { status: 404, body: { error: "לא נמצאה עמדה זמינה לפריט זה" } };
    }

    return {
        status: 200,
        body: {
            itemId: Number(row.itemId),
            currentStatus,
            serialNo: row.serialNo,
            makat: row.makat ?? null,
            model: row.model,
            stationId,
            stationTypeId,
        },
    };
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const barcode = searchParams.get("barcode");

        if (!barcode) {
            return NextResponse.json({ error: "barcode is required" }, { status: 400 });
        }

        let itemId: number;
        try {
            ({ itemId } = parseBarcode(barcode));
        } catch {
            return NextResponse.json({ error: "ברקוד לא תקין" }, { status: 400 });
        }

        const itemIdBig = BigInt(itemId);
        let found = await locate(itemIdBig);

        if (found.status === 404 && found.body.notFound) {
            const resolved = await resolveLegacyId(itemIdBig);
            if (resolved != null && resolved !== itemIdBig) {
                found = await locate(resolved);
                found = {
                    status: found.status,
                    body: { ...found.body, legacyId: Number(itemIdBig), resolvedItemId: Number(resolved) },
                };
            }
        }

        const { notFound: _nf, ...body } = found.body;
        return NextResponse.json(body, { status: found.status });
    } catch (error) {
        console.error("Error locating item by barcode:", error);
        return NextResponse.json({ error: "שגיאה באיתור הפריט" }, { status: 500 });
    }
}
