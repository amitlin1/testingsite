import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { parseBarcode } from "@/app/lib/barcode-parser";

export const runtime = "nodejs";

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    const [itemResult, connectedResult, historyResult] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          i.item_id,
          i.makat,
          i.serial_no,
          i.parent_item_id,
          it.item_type_desc,
          ir.current_status,
          ir.current_status AS item_status_id,
          s.item_status_desc,
          tr.route_steps,
          tst.test_type_desc,
          ir.current_route_step,
          ir.test_station_id,
          ts.test_station_desc,
          ir.created_at,
          ir.finished_at,
          ir.is_finished,
          (
              SELECT json_agg(
                         json_build_object(
                             'id', u.step,
                             'desc', tst2.test_type_desc
                         )
                         ORDER BY u.ord
                     )
              FROM (
                  SELECT step, ord
                  FROM unnest(tr.route_steps) WITH ORDINALITY AS u(step, ord)
              ) u
              JOIN test_stations_type tst2
                  ON tst2.test_station_type_id = u.step
          ) AS route_stations
      FROM items i
      LEFT JOIN item_types it           ON it.item_type_id = i.item_type_id
      LEFT JOIN item_routes ir          ON ir.item_id = i.item_id
      LEFT JOIN item_status s           ON s.item_status_id = ir.current_status
      LEFT JOIN test_stations ts        ON ts.test_station_id = ir.test_station_id
      LEFT JOIN testing_routes tr       ON tr.item_type_id = i.item_type_id and tr.route_number = ir.route_number
      LEFT JOIN test_stations_type tst  ON tst.test_station_type_id = ANY(tr.route_steps)
      WHERE i.item_id = ${itemIdBig}
      ORDER BY i.item_id DESC
      LIMIT 1
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          i.item_id,
          i.serial_no,
          it.item_type_desc,
          ir.current_status,
          s.item_status_desc,
          CASE
              WHEN i.item_id = (SELECT COALESCE(parent_item_id, item_id) FROM items WHERE item_id = ${itemIdBig}) THEN 'Parent'
              ELSE 'Child'
          END as relation_type
        FROM items i
        JOIN item_types it ON i.item_type_id = it.item_type_id
        LEFT JOIN item_routes ir ON i.item_id = ir.item_id
        LEFT JOIN item_status s ON ir.current_status = s.item_status_id
        WHERE
          (
              i.parent_item_id = (SELECT CASE WHEN parent_item_id IS NOT NULL THEN parent_item_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
              OR
              i.item_id = (SELECT CASE WHEN parent_item_id IS NOT NULL THEN parent_item_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
          )
          AND i.item_id != ${itemIdBig}
      `,
      prisma.$queryRaw<any[]>`
        SELECT h.*, w.worker_name
        FROM item_route_history h
        LEFT JOIN workers w ON h.worker_id = w.worker_id
        WHERE h.item_id = ${itemIdBig}
        ORDER BY h.log_id DESC
        LIMIT 200
      `,
    ]);

    const normalizedItem = itemResult[0] ? {
      ...itemResult[0],
      connected_items: connectedResult,
      created_at: normalizeToUtcIso(itemResult[0].created_at),
      finished_at: normalizeToUtcIso(itemResult[0].finished_at),
    } : null;

    const normalizedHistory = historyResult.map((row: any) => ({
      ...row,
      queue_start_time: normalizeToUtcIso(row.queue_start_time),
      processing_start_time: normalizeToUtcIso(row.processing_start_time),
      processing_end_time: normalizeToUtcIso(row.processing_end_time),
    }));

    return NextResponse.json(serializeBigInts({
      item: normalizedItem,
      history: normalizedHistory,
    }));
  } catch (error) {
    console.error("Error loading item:", error);
    return NextResponse.json({
      item: null,
      history: [],
    });
  }
}
