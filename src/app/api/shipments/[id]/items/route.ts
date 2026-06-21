import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/shipments/[id]/items
 *
 * Fetches all items from shipment_items for a specific shipment,
 * along with the count of items already in item_routes (sample count).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shipmentId = parseInt(id, 10);

    if (isNaN(shipmentId)) {
      return NextResponse.json(
        { error: "Invalid shipment ID" },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        si.id,
        si.shipment_id,
        si.item_type_id,
        TRIM(it.item_type_desc) AS item_type_desc,
        si.quantity AS total_quantity,
        si.makat,
        COALESCE(route_counts.sample_count, 0) AS sample_count
      FROM shipment_items si
      JOIN item_types it ON it.item_type_id = si.item_type_id
      LEFT JOIN (
        SELECT
          i.item_type_id,
          i.shipment_id,
          COUNT(DISTINCT ir.item_id) AS sample_count
        FROM items i
        JOIN item_routes ir ON ir.item_id = i.item_id
        WHERE i.shipment_id = ${shipmentId}
        GROUP BY i.item_type_id, i.shipment_id
      ) route_counts ON route_counts.item_type_id = si.item_type_id
                     AND route_counts.shipment_id = si.shipment_id
      WHERE si.shipment_id = ${shipmentId}
      ORDER BY si.id
    `;

    // Convert BigInt values to Number for JSON serialization
    const serializedRows = rows.map((row: any) => ({
      ...row,
      sample_count: Number(row.sample_count),
    }));

    return NextResponse.json(serializedRows);
  } catch (error: any) {
    console.error("Error fetching shipment items:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipment items", details: error.message },
      { status: 500 }
    );
  }
}
