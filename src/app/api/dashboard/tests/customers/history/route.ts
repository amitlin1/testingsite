import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { CustomerPerformanceRow } from "@/types/dashboard";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/tests/customers/history
 *
 * מחזיר היסטוריה של לקוח מסוים לאורך זמן
 *
 * Query params:
 * - customerId: מזהה הלקוח (חובה)
 * - startDate: תאריך התחלה (YYYY-MM-DD)
 * - endDate: תאריך סיום (YYYY-MM-DD)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!customerId) {
      return NextResponse.json(
        { error: "customerId is required" },
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
      SNAPSHOT_TABLES.customer,
      startDate,
      endDate
    );

    let query = `
      SELECT
        snapshot_date,
        customer_id,
        customer_code,
        customer_name,
        total_items,
        items_in_queue,
        items_in_test,
        items_waiting_for_research,
        items_in_research,
        finished_items,
        items_in_routes,
        success_percentage,
        items_in_routes_percentage,
        average_time_minutes,
        created_at
      FROM ${tableName}
      WHERE customer_id = $1::int
        AND snapshot_date >= $2::date
        AND snapshot_date <= $3::date
      ORDER BY snapshot_date ASC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(query, parseInt(customerId, 10), startDate, endDate);

    const history: CustomerPerformanceRow[] = rows.map((row: any) => ({
      customerId: row.customer_id,
      customerCode: row.customer_code || '',
      customerName: row.customer_name || '',
      totalItems: Number(row.total_items) || 0,
      itemsInQueue: Number(row.items_in_queue) || 0,
      itemsInTest: Number(row.items_in_test) || 0,
      itemsWaitingForResearch: Number(row.items_waiting_for_research) || 0,
      itemsInResearch: Number(row.items_in_research) || 0,
      finishedItems: Number(row.finished_items) || 0,
      itemsInRoutes: Number(row.items_in_routes) || 0,
      successPercentage: Number(row.success_percentage) || 0,
      itemsInRoutesPercentage: Number(row.items_in_routes_percentage) || 0,
      averageTimeMinutes: row.average_time_minutes ? Number(row.average_time_minutes) : null,
    }));

    return NextResponse.json({
      customerId: parseInt(customerId, 10),
      history,
      count: history.length
    });
  } catch (error: any) {
    console.error("Error fetching customer history:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch customer history",
        message: error.message || "Unknown error"
      },
      { status: 500 }
    );
  }
}
