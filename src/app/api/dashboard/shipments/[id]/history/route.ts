
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "alldays";
  const shipmentId = params.id;

  if (!shipmentId) {
    return NextResponse.json({ error: "Shipment ID is required" }, { status: 400 });
  }

  try {
    let tableName = "shipment_snapshots";
    let startDate: Date | null = null;
    const endDate = new Date();

    if (period === "3years") {
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 3);
      tableName = "shipment_snapshots_monthly"; // Use monthly for quarterly view
    } else if (period === "12months") {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      tableName = "shipment_snapshots_monthly";
    } else {
      tableName = "shipment_snapshots";
    }

    // Check if table exists, fallback to daily
    if (period !== "alldays") {
      const checkQuery = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )
      `;
      const tableCheckRows = await prisma.$queryRawUnsafe<any[]>(checkQuery, tableName);

      if (!tableCheckRows[0].exists) {
        tableName = "shipment_snapshots";
      }
    }

    let query = `
      SELECT
        snapshot_date as date,
        total_items as "totalItems",
        items_in_queue as "itemsInQueue",
        items_in_test as "itemsInTest",
        items_waiting_for_research as "itemsWaitingForResearch",
        items_in_research as "itemsInResearch",
        items_finished as "itemsFinished",
        items_in_routes as "itemsInRoutes",
        completion_percentage as "completionPercentage"
      FROM ${tableName}
      WHERE shipment_id = $1::integer
    `;

    const queryParams: any[] = [shipmentId];

    if (startDate) {
      query += ` AND snapshot_date >= $2::date AND snapshot_date <= $3::date`;
      queryParams.push(startDate, endDate);
    }

    query += ` ORDER BY snapshot_date ASC`;

    let snapshotRows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);

    // Filter for Quarterly view (Jan, Apr, Jul, Oct) if period is 3years
    if (period === "3years") {
      snapshotRows = snapshotRows.filter((row: any) => {
        const d = new Date(row.date);
        return [0, 3, 6, 9].includes(d.getMonth());
      });
    }

    // Fetch TODAY's live data from real tables
    const todayQuery = `
      SELECT
        NOW()::date AS date,
        s.amount AS "totalItems",
        COUNT(DISTINCT CASE WHEN ir.current_status = 2 THEN i.item_id END) AS "itemsInQueue",
        COUNT(DISTINCT CASE WHEN ir.current_status = 1 THEN i.item_id END) AS "itemsInTest",
        COUNT(DISTINCT CASE WHEN ir.current_status = 4 THEN i.item_id END) AS "itemsWaitingForResearch",
        COUNT(DISTINCT CASE WHEN ir.current_status = 5 THEN i.item_id END) AS "itemsInResearch",
        COUNT(DISTINCT CASE WHEN ir.current_status = 3 THEN i.item_id END) AS "itemsFinished",
        COUNT(DISTINCT ir.item_id) AS "itemsInRoutes"
      FROM shipments s
      LEFT JOIN items i ON i.shipment_id = s.id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      WHERE s.id = $1::integer
      GROUP BY s.id, s.amount
    `;

    const todayRows = await prisma.$queryRawUnsafe<any[]>(todayQuery, shipmentId);

    let results = snapshotRows;

    // Add today's live data point
    if (todayRows.length > 0) {
      const todayData = todayRows[0];
      const totalItems = Number(todayData.totalItems) || 0;
      const itemsFinished = Number(todayData.itemsFinished) || 0;

      const itemsInRoutes = Number(todayData.itemsInRoutes) || 0;

      const completionPercentage = itemsInRoutes > 0
        ? Math.round((itemsFinished / itemsInRoutes) * 100)
        : 0;

      const todayPoint = {
        date: new Date().toISOString().split('T')[0],
        totalItems,
        itemsInQueue: Number(todayData.itemsInQueue) || 0,
        itemsInTest: Number(todayData.itemsInTest) || 0,
        itemsWaitingForResearch: Number(todayData.itemsWaitingForResearch) || 0,
        itemsInResearch: Number(todayData.itemsInResearch) || 0,
        itemsFinished,
        itemsInRoutes: Number(todayData.itemsInRoutes) || 0,
        completionPercentage,
        isToday: true
      };

      const lastDate = results.length > 0 ? new Date(results[results.length - 1].date).toDateString() : null;
      const todayStr = new Date().toDateString();

      if (lastDate !== todayStr) {
        results = [...results, todayPoint];
      } else {
        results[results.length - 1] = { ...results[results.length - 1], ...todayPoint };
      }
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("Error fetching shipment history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
