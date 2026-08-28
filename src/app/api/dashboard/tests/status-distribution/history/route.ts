import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import { getSnapshotTableName, SNAPSHOT_TABLES } from "@/app/lib/snapshot-tables";

export const runtime = "nodejs";

export const GET = withAuth(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    // Read filter parameters
    const customerId = searchParams.get("customerId");
    const shipmentId = searchParams.get("shipmentId");
    const itemTypeId = searchParams.get("itemTypeId");
    const testStationId = searchParams.get("testStationId");

    // Determine which table to use based on date range
    const tableName = getSnapshotTableName(
      SNAPSHOT_TABLES.statusDistribution,
      startDate,
      endDate
    );

    // Determine if we're using monthly or quarterly
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const useMonthly = daysDiff > 90;
    const isQuarterlyRequest = daysDiff > 1500; // Flag for filtering later

    // Query to get historical status distribution from snapshots
    // For monthly/quarterly, we need to match by truncated dates
    // NOTE: We use 'month' truncation for both monthly and quarterly, 
    // then filter for quarterly in JS because we lack quarterly tables.
    const query = `
      SELECT
        snapshot_date,
        status_id,
        status_name,
        count,
        percentage
      FROM ${tableName}
      WHERE snapshot_date >= ${useMonthly ? "date_trunc('month', $1::date)" : "$1::date"}
        AND snapshot_date <= ${useMonthly ? "date_trunc('month', $2::date)" : "$2::date"}
      ORDER BY snapshot_date, status_id
    `;

    let rows = await prisma.$queryRawUnsafe<any[]>(query, startDate, endDate);

    // Filter for Quarterly view (Jan, Apr, Jul, Oct) if requested
    if (isQuarterlyRequest) {
      rows = rows.filter((row: any) => {
        const d = new Date(row.snapshot_date);
        return [0, 3, 6, 9].includes(d.getMonth());
      });
    }

    // Group by date and transform to chart format
    const groupedByDate: { [date: string]: any[] } = {};

    rows.forEach((row: any) => {
      const date = row.snapshot_date.toISOString().split('T')[0];
      if (!groupedByDate[date]) {
        groupedByDate[date] = [];
      }
      groupedByDate[date].push({
        status: String(row.status_id),
        statusName: row.status_name || `סטטוס ${row.status_id}`,
        count: Number(row.count) || 0,
        percentage: Number(row.percentage) || 0,
      });
    });

    // --- ALWAYS APPEND LIVE DATA FOR TODAY ---
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Build filter conditions for live query
    const liveParams: any[] = [];
    let liveIdx = 1;
    const liveConds: string[] = [];

    if (customerId) { liveConds.push(`AND i.customer_id = $${liveIdx}::int`); liveParams.push(customerId); liveIdx++; }
    if (shipmentId) { liveConds.push(`AND i.shipment_id = $${liveIdx}::int`); liveParams.push(shipmentId); liveIdx++; }
    if (itemTypeId) { liveConds.push(`AND i.item_type_id = $${liveIdx}::int`); liveParams.push(itemTypeId); liveIdx++; }
    if (testStationId) { liveConds.push(`AND ir.test_station_id = $${liveIdx}::int`); liveParams.push(testStationId); liveIdx++; }

    // Always fetch live data from item_routes for "Today"
    const liveQuery = `
      SELECT
        ir.current_status as status_id,
        s.item_status_desc as status_name,
        COUNT(DISTINCT ir.item_id) as count
      FROM item_routes ir
      LEFT JOIN item_status s ON s.item_status_id = ir.current_status
      JOIN items i ON i.item_id = ir.item_id
      WHERE 1=1
      ${liveConds.join(" ")}
      GROUP BY ir.current_status, s.item_status_desc
    `;

    const liveRows = await prisma.$queryRawUnsafe<any[]>(liveQuery, ...liveParams);
    const liveTotal = liveRows.reduce((sum: number, r: any) => sum + Number(r.count), 0);

    const liveStatuses = liveRows.map((row: any) => ({
         status: String(row.status_id),
         statusName: row.status_name || `סטטוס ${row.status_id}`,
         count: Number(row.count) || 0,
         percentage: liveTotal > 0 ? Math.round((Number(row.count) / liveTotal) * 100 * 10) / 10 : 0,
    }));

    // Always add today's live data (replacing any existing snapshot for today)
    if (liveStatuses.length > 0) {
        groupedByDate[todayStr] = liveStatuses;
    }

    // Transform to time series format
    const timeSeriesData = Object.keys(groupedByDate)
      .sort()
      .map((date) => ({
        date,
        statuses: groupedByDate[date],
        isToday: date === todayStr,
      }));

    return NextResponse.json(timeSeriesData);
  } catch (error) {
    console.error("Error fetching status distribution history:", error);
    return NextResponse.json(
      { error: "Failed to fetch status distribution history" },
      { status: 500 }
    );
  }
}, { role: "manager" });
