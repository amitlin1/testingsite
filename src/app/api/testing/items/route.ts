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
        st.test_station_type_id,
        st.is_research,
        COALESCE(stt.parents_only, false) AS parents_only
    FROM test_stations st
    LEFT JOIN test_stations_type stt
        ON stt.test_station_type_id = st.test_station_type_id
    WHERE st.test_station_id = ${stationIdNum}
)
SELECT
    t1.item_id,
    t1.item_type_id,
    t1.current_status,
    t1.current_route_step,
    t1.test_station_id,
    t1.created_at,
    t1.processing_start_time,
    t1.queue_start_time,
    t1.finished_at,
    t1.is_finished,
    t3.item_status_desc,
    t2.route_steps,
    i.serial_no,
    i.makat,
    i.model,
    TRIM(c.customer_code) AS "customer_code",
    i.manufacturer_name,
    i.manufacturer_no,
    TRIM(it.item_type_desc) AS "item_type_desc",
    t1.route_number,
    i.parent_item_id,
    (SELECT parent.serial_no FROM items parent WHERE parent.item_id = i.parent_item_id) AS "parent_serial_no",
    (EXISTS (SELECT 1 FROM items child WHERE child.parent_item_id = i.item_id)) AS "has_children",
    (
        SELECT json_agg(json_build_object(
            'item_id', connected.item_id,
            'serial_no', connected.serial_no
        ))
        FROM items connected
        WHERE
            (
                (i.parent_item_id IS NOT NULL AND (connected.parent_item_id = i.parent_item_id OR connected.item_id = i.parent_item_id))
                OR
                (i.parent_item_id IS NULL AND connected.parent_item_id = i.item_id)
            )
            AND connected.item_id != i.item_id
    ) AS "connected_items"
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
    -- Station types flagged parents_only test a parent together with its
    -- accessories, so the accessories never appear in the queue themselves.
    (ss.parents_only = false OR i.parent_item_id IS NULL)
    AND (
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
    )
ORDER BY
    CASE WHEN t1.current_status = 1 THEN 0 ELSE 1 END,
    t1.created_at DESC
        `;

        // Normalize snake_case rows to the ItemRow shape: numeric ids, UTC ISO
        // timestamps, and route_steps guaranteed to be an array.
        const normalizedRows = rows.map((row: any) => ({
            ...row,
            item_id: row.item_id != null ? Number(row.item_id) : null,
            test_station_id: row.test_station_id != null ? Number(row.test_station_id) : null,
            parent_item_id: row.parent_item_id != null ? Number(row.parent_item_id) : null,
            created_at: normalizeToUtcIso(row.created_at),
            processing_start_time: normalizeToUtcIso(row.processing_start_time),
            queue_start_time: normalizeToUtcIso(row.queue_start_time),
            finished_at: normalizeToUtcIso(row.finished_at),
            route_steps: Array.isArray(row.route_steps) ? row.route_steps : (row.route_steps ? [row.route_steps] : []),
            connected_items: row.connected_items?.map((ci: any) => ({
                ...ci,
                item_id: ci.item_id != null ? Number(ci.item_id) : null,
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
