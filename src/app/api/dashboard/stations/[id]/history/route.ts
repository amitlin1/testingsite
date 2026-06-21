
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "alldays";
  const stationId = params.id;
  const showAllHistory = searchParams.get("showAllHistory") === "true";

  if (!stationId) {
    return NextResponse.json({ error: "Station ID is required" }, { status: 400 });
  }

  try {
    let tableName = "station_snapshots";
    let startDate: Date | null = null;
    const endDate = new Date();

    if (period === "3years") {
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 3);
      tableName = "station_snapshots_monthly"; // Use monthly for quarterly view
    } else if (period === "12months") {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      tableName = "station_snapshots_monthly";
    } else {
      tableName = "station_snapshots";
    }

    // Check if table exists, fallback to daily
    if (period !== "alldays") {
      const tableCheckRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )
      `, tableName);

      if (!tableCheckRows[0].exists) {
        tableName = "station_snapshots";
      }
    }

    let query = `
      SELECT
        snapshot_date as date,
        items_in_queue as "itemsInQueue",
        items_in_test as "itemsInTest",
        average_current_queue_time_minutes as "averageQueueTime",
        total_processed_in_period as "totalProcessed"
      FROM ${tableName}
      WHERE station_id = $1::integer
    `;

    const queryParams: any[] = [stationId];

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

    // Build shipment filter for live data
    const shipmentFilter = !showAllHistory
      ? `AND EXISTS (
           SELECT 1 FROM items i_fs
           JOIN shipments s_fs ON i_fs.shipment_id = s_fs.id
           WHERE i_fs.item_id = ir.item_id AND s_fs.is_sent = false
         )`
      : "";

    // Fetch TODAY's live data from real tables
    const todayQuery = `
      SELECT
        NOW()::date AS date,
        COUNT(CASE WHEN ir.current_status IN (2, 4) AND ir.finished_at IS NULL THEN 1 END) AS "itemsInQueue",
        COUNT(CASE WHEN ir.current_status IN (1, 5) AND ir.finished_at IS NULL THEN 1 END) AS "itemsInTest",
        AVG(
          CASE
            WHEN ir.current_status IN (2, 4) AND ir.finished_at IS NULL AND ir.queue_start_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (NOW() - ir.queue_start_time)) / 60.0
            ELSE NULL
          END
        ) AS "averageQueueTime",
        COUNT(CASE WHEN ir.finished_at IS NOT NULL AND ir.finished_at::date = NOW()::date THEN 1 END) AS "totalProcessed"
      FROM test_stations ts
      LEFT JOIN item_routes ir ON ir.test_station_id = ts.test_station_id
      WHERE ts.test_station_id = $1::integer
        ${shipmentFilter}
      GROUP BY ts.test_station_id
    `;

    const todayRows = await prisma.$queryRawUnsafe<any[]>(todayQuery, stationId);

    let results = snapshotRows;

    // Add today's live data point
    if (todayRows.length > 0) {
      const todayData = todayRows[0];

      const todayPoint = {
        date: new Date().toISOString().split('T')[0],
        itemsInQueue: Number(todayData.itemsInQueue) || 0,
        itemsInTest: Number(todayData.itemsInTest) || 0,
        averageQueueTime: todayData.averageQueueTime ? Number(todayData.averageQueueTime) : 0,
        totalProcessed: Number(todayData.totalProcessed) || 0,
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
    console.error("Error fetching station history:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
