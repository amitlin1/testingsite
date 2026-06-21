
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const customerId = searchParams.get("customerId");
  const shipmentId = searchParams.get("shipmentId");
  const itemTypeId = searchParams.get("itemTypeId");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "Date range required" }, { status: 400 });
  }

  try {
    // If we have filters, calculating completion history from snapshots is hard (snapshots are aggregated).
    // We will use a CTE approach on `item_route_history` / `item_routes` to generate the trend.
    // Or, for simplicity/speed, if filtered by Shipment, we can just query `item_routes` for that shipment and build the history.

    // Strategy:
    // 1. Identify Target Shipments (based on Filters).
    // 2. For each day in range, calculate % complete for these shipments.

    // Actually, "Completion History" usually shows lines for specific shipments.
    // If no shipment selected, it shows top active shipments?
    // The previous implementation queried `shipment_snapshots_monthly` which implies it showed ALL shipments or a subset.

    // If specific Shipment Filter is active, we should show ONLY that shipment's history.
    // If Customer Filter active, show shipments for that customer.

    const conditions: string[] = [];
    const params: any[] = [startDate, endDate];
    let pIdx = 3;

    if (customerId) { conditions.push(`AND s.customer_id = $${pIdx}::int`); params.push(customerId); pIdx++; }
    if (shipmentId) { conditions.push(`AND s.shipment_id = $${pIdx}::int`); params.push(shipmentId); pIdx++; }

    // If filters exist, we might need a robust query.
    // But let's check if we can use the `shipment_snapshots` table if it has customer_id?
    // Usually snapshot tables have limited columns.

    // Assuming we fallback to specific query if filters active.

    const query = `
        SELECT
            ss.snapshot_date as date,
            ss.shipment_code as "shipmentCode",
            ss.completion_percentage as "completionPercentage"
        FROM shipment_snapshots_monthly ss
        JOIN shipments s ON s.shipment_code = ss.shipment_code -- Join to filter by customer if needed
        WHERE ss.snapshot_date >= $1::date AND ss.snapshot_date <= $2::date
        ${conditions.join(" ")}
        ORDER BY ss.snapshot_date ASC, ss.shipment_code ASC
    `;

    // Note: This relies on joining snapshots with shipments table.
    // This assumes shipment_code is unique/joinable.

    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // Transform data
    const groupedData = rows.reduce((acc: any[], row: any) => {
        const dateStr = row.date.toISOString().split('T')[0];
        let existing = acc.find(item => item.date === dateStr);
        if (!existing) {
            existing = { date: dateStr };
            acc.push(existing);
        }
        existing[row.shipmentCode] = parseFloat(row.completionPercentage).toFixed(1);
        return acc;
    }, []);

    return NextResponse.json(groupedData);
  } catch (error: any) {
    console.error("Error fetching completion history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
