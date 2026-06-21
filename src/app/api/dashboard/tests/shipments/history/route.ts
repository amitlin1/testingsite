import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ShipmentTrackingRow } from "@/types/dashboard";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/tests/shipments/history
 *
 * מחזיר היסטוריה של משלוח מסוים לאורך זמן
 *
 * Query params:
 * - shipmentId: מזהה המשלוח (חובה)
 * - startDate: תאריך התחלה (YYYY-MM-DD)
 * - endDate: תאריך סיום (YYYY-MM-DD)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const shipmentId = searchParams.get("shipmentId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!shipmentId) {
      return NextResponse.json(
        { error: "shipmentId is required" },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    // Determine which table to use based on date range
    const tableName = getSnapshotTableName(
      SNAPSHOT_TABLES.shipment,
      startDate,
      endDate
    );

    let query = `
      SELECT
        snapshot_date,
        shipment_id,
        shipment_code,
        shipment_date,
        customer_id,
        customer_code,
        customer_name,
        total_items,
        items_in_queue,
        items_in_test,
        items_waiting_for_research,
        items_in_research,
        items_finished,
        items_in_routes,
        completion_percentage,
        items_in_routes_percentage,
        created_at
      FROM ${tableName}
      WHERE shipment_id = $1::int
        AND snapshot_date >= $2::date
        AND snapshot_date <= $3::date
      ORDER BY snapshot_date ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, parseInt(shipmentId, 10), startDate, endDate);

    const history: ShipmentTrackingRow[] = rows.map((row: any) => ({
      shipmentId: row.shipment_id,
      shipmentCode: row.shipment_code,
      shipmentDate: row.shipment_date ? new Date(row.snapshot_date).toISOString().split('T')[0] : '',
      customerCode: row.customer_code || '',
      customerName: row.customer_name || '',
      totalItems: Number(row.total_items) || 0,
      itemsInQueue: Number(row.items_in_queue) || 0,
      itemsInTest: Number(row.items_in_test) || 0,
      itemsWaitingForResearch: Number(row.items_waiting_for_research) || 0,
      itemsInResearch: Number(row.items_in_research) || 0,
      itemsFinished: Number(row.items_finished) || 0,
      itemsInRoutes: Number(row.items_in_routes) || 0,
      completionPercentage: Number(row.completion_percentage) || 0,
      itemsInRoutesPercentage: Number(row.items_in_routes_percentage) || 0,
    }));

    return NextResponse.json({
      shipmentId: parseInt(shipmentId, 10),
      history,
      count: history.length
    });
  } catch (error: any) {
    console.error("Error fetching shipment history:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch shipment history",
        message: error.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
