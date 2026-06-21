import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";

export const runtime = "nodejs";

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const stationId = searchParams.get("stationId");
        console.log(stationId)
        if (!stationId) {
            return NextResponse.json({ error: "stationId is required" }, { status: 400 });
        }

        const stationIdNum = Number(stationId);
        if (isNaN(stationIdNum)) {
            return NextResponse.json({ error: "Invalid stationId" }, { status: 400 });
        }

        const rows = await prisma.$queryRaw<any[]>`
     WITH selected_station AS (
    SELECT
        test_station_type_id,
        is_research
    FROM test_stations
    WHERE test_station_id = ${stationIdNum}
)
SELECT
    t1.item_id AS "itemId",
    t1.item_type_id AS "itemTypeId",
    t1.current_status AS "currentStatus",
    t1.current_route_step AS "currentRouteStep",
    t1.test_station_id AS "testStationId",
    t1.created_at AS "createdAt",
    t1.processing_start_time AS "processingStartTime",
    t1.queue_start_time AS "qStartTime",
    t1.finished_at AS "finishedAt",
    t1.is_finished AS "isFinished",
    t3.item_status_desc AS "itemStatusDesc",
    t2.route_steps AS "routeSteps",
    t2.route_steps[t1.current_route_step] AS "stepIndex",
    i.serial_no AS "serialNo",
    i.makat,
    i.model,
    TRIM(c.customer_code) AS "customerCode",
    i.manufacturer_name AS "manufacturerName",
    i.manufacturer_no AS "manufacturerNo",
    TRIM(it.item_type_desc) AS "itemTypeDesc",
    t1.route_number AS "routeNumber",
    i.parent_item_id AS "parentItemId",
    (EXISTS (SELECT 1 FROM items child WHERE child.parent_item_id = i.item_id)) AS "hasChildren",
    (
        SELECT json_agg(json_build_object(
            'itemId', connected.item_id,
            'serialNo', connected.serial_no
        ))
        FROM items connected
        WHERE
            (
                (i.parent_item_id IS NOT NULL AND (connected.parent_item_id = i.parent_item_id OR connected.item_id = i.parent_item_id))
                OR
                (i.parent_item_id IS NULL AND connected.parent_item_id = i.item_id)
            )
            AND connected.item_id != i.item_id
    ) AS "connectedItems"
FROM item_routes t1
INNER JOIN items i
    ON i.item_id = t1.item_id
LEFT JOIN customers c
    ON c.id = i.customer_id
JOIN testing_routes t2
    ON t1.item_type_id = t2.item_type_id
   AND t1.route_number = t2.route_number
JOIN item_status t3
    ON t1.current_status = t3.item_status_id
LEFT JOIN item_types it
    ON it.item_type_id = i.item_type_id
CROSS JOIN selected_station ss
WHERE
    (
        t1.current_status = 1
        AND t1.test_station_id = ${stationIdNum}
        AND t1.finished_at IS NULL
    )
    OR
    (
        t1.current_status = 2
        AND t2.route_steps[t1.current_route_step] = ss.test_station_type_id
        AND t1.finished_at IS NULL
    )
    OR
    (
        ss.is_research = true
        AND (
            (
                t1.current_status = 5
                AND t1.test_station_id = ${stationIdNum}
                AND t1.finished_at IS NULL
            )
            OR
            (
                t1.current_status = 4
                AND t1.finished_at IS NULL
            )
        )
    )
ORDER BY
    CASE WHEN t1.current_status = 1 THEN 0 ELSE 1 END,
    t1.created_at DESC
        `;

        // Normalize all timestamp fields to UTC ISO strings and convert BigInt to string
        const normalizedRows = rows.map((row: any) => ({
            ...row,
            itemId: row.itemId?.toString(),
            testStationId: row.testStationId?.toString(),
            parentItemId: row.parentItemId?.toString(),
            createdAt: normalizeToUtcIso(row.createdAt),
            processingStartTime: normalizeToUtcIso(row.processingStartTime),
            qStartTime: normalizeToUtcIso(row.qStartTime),
            finishedAt: normalizeToUtcIso(row.finishedAt),
            routeSteps: Array.isArray(row.routeSteps) ? row.routeSteps : (row.routeSteps ? [row.routeSteps] : []),
            connectedItems: row.connectedItems?.map((ci: any) => ({
                ...ci,
                itemId: ci.itemId?.toString(),
            })),
        }));

        const json = JSON.stringify(normalizedRows, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );

        return new NextResponse(json, {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error loading items by station:", error);
        return NextResponse.json([]);
    }
}
