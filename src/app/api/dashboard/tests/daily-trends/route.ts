import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { DailyTrendPoint } from "@/types/dashboard";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

export const runtime = "nodejs";

export async function GET(req: Request) {
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

    const customerId = searchParams.get("customerId");
    const shipmentId = searchParams.get("shipmentId");
    const itemSerial = searchParams.get("itemSerial");
    const itemTypeId = searchParams.get("itemTypeId");
    const testStationId = searchParams.get("testStationId");
    const testStationTypeId = searchParams.get("testStationTypeId");
    const workerId = searchParams.get("workerId");
    const status = searchParams.get("status");

    const useComplexLogic =
      !!itemSerial ||
      !!workerId ||
      !!testStationTypeId ||
      (status && status !== "all");

    // CALCULATION METHOD 1: REAL-TIME CTE (For complex filters)
    if (useComplexLogic) {
      const params: any[] = [];
      let pIdx = 3;
      const conditions: string[] = [];

      if (customerId) { conditions.push(`AND i.customer_id = $${pIdx}::int`); params.push(customerId); pIdx++; }
      if (shipmentId) { conditions.push(`AND i.shipment_id = $${pIdx}::int`); params.push(shipmentId); pIdx++; }
      if (itemTypeId) { conditions.push(`AND i.item_type_id = $${pIdx}::int`); params.push(itemTypeId); pIdx++; }
      if (testStationId) { conditions.push(`AND ir.test_station_id = $${pIdx}::int`); params.push(testStationId); pIdx++; }
      if (itemSerial) { conditions.push(`AND i.serial_no = $${pIdx}`); params.push(itemSerial); pIdx++; }

      let joinStarted = "";
      if (testStationTypeId) {
        joinStarted += ` JOIN test_stations ts ON ts.test_station_id = ir.test_station_id`;
        conditions.push(`AND ts.test_station_type_id = $${pIdx}::int`);
        params.push(testStationTypeId);
        pIdx++;
      }
      if (workerId) {
        joinStarted += ` JOIN item_route_history irh ON irh.item_id = ir.item_id`;
        conditions.push(`AND irh.worker_id = $${pIdx}::int`);
        params.push(workerId);
        pIdx++;
      }

      const query = `
          WITH date_series AS (
            SELECT date_trunc('day', d)::date AS date
            FROM generate_series($1::timestamp, $2::timestamp, '1 day'::interval) AS d
          ),
          daily_stats AS (
            SELECT
              date_trunc('day', ir.created_at)::date as date,
              COUNT(DISTINCT CASE WHEN ir.current_status IN (2, 4) THEN ir.item_id END) as in_queue,
              COUNT(DISTINCT CASE WHEN ir.current_status IN (1, 5) THEN ir.item_id END) as in_test,
              COUNT(DISTINCT CASE WHEN ir.finished_at IS NOT NULL THEN ir.item_id END) as finished
            FROM item_routes ir
            JOIN items i ON i.item_id = ir.item_id
            ${joinStarted}
            WHERE ir.created_at >= $1::timestamp AND ir.created_at <= $2::timestamp
            ${conditions.join(" ")}
            GROUP BY 1
          )
          SELECT
            ds.date,
            COALESCE(s.finished, 0) as items_finished,
            COALESCE(s.in_queue, 0) as items_in_queue,
            COALESCE(s.in_test, 0) as items_in_test
          FROM date_series ds
          LEFT JOIN daily_stats s ON s.date = ds.date
          ORDER BY ds.date
        `;

      const rows = await prisma.$queryRawUnsafe<any[]>(query, startDate, endDate, ...params);
      return NextResponse.json(rows.map((row: any) => ({
        date: new Date(row.date).toISOString().split('T')[0],
        itemsStarted: 0,
        itemsFinished: Number(row.items_finished),
        itemsInQueue: Number(row.items_in_queue),
        itemsInTest: Number(row.items_in_test)
      })));
    }

    // CALCULATION METHOD 2: SNAPSHOTS (Fast, for standard usage)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    let suffix = "_daily";
    let isQuarterly = false;

    if (daysDiff > 365) {
      suffix = "_monthly";
      isQuarterly = true;
    } else if (daysDiff > 35) {
      suffix = "_monthly";
    }

    let tableName = `system_snapshots${suffix}`;
    let filterCol = "";
    let filterVal = "";

    if (customerId) { tableName = `customer_snapshots${suffix}`; filterCol = "customer_id"; filterVal = customerId; }
    else if (itemTypeId) { tableName = `item_type_snapshots${suffix}`; filterCol = "item_type_id"; filterVal = itemTypeId; }
    else if (testStationId) { tableName = `station_snapshots${suffix}`; filterCol = "station_id"; filterVal = testStationId; }
    else if (shipmentId) { tableName = `shipment_snapshots${suffix}`; filterCol = "shipment_id"; filterVal = shipmentId; }

    const params: any[] = [startDate, endDate];
    let query = "";

    if (filterCol) {
      query = `
            SELECT snapshot_date as date, items_in_queue, items_in_test, items_waiting_for_research, items_in_research,
                ${tableName.includes('station') ? 'total_processed_in_period' : 'items_finished'} as items_finished,
                ${tableName.includes('station') ? '0' : 'items_in_routes'} as items_started
            FROM ${tableName}
            WHERE snapshot_date >= $1::date AND snapshot_date <= $2::date
            AND ${filterCol} = $3
            ORDER BY snapshot_date ASC
        `;
      params.push(filterVal);
    } else {
      query = `
            SELECT snapshot_date as date, items_in_queue, items_in_test, items_waiting_for_research, items_in_research, items_finished, items_in_routes as items_started
            FROM ${tableName}
            WHERE snapshot_date >= $1::date AND snapshot_date <= $2::date
            ORDER BY snapshot_date ASC
        `;
    }

    let snapshotRows = await prisma.$queryRawUnsafe<any[]>(query, ...params);

    // If Quarterly view is requested, filter the monthly rows to show only Jan, Apr, Jul, Oct
    if (isQuarterly) {
      snapshotRows = snapshotRows.filter((row: any) => {
        const d = new Date(row.date);
        // getMonth() is 0-indexed (0=Jan, 3=Apr, 6=Jul, 9=Oct)
        return [0, 3, 6, 9].includes(d.getMonth());
      });
    }

    const trends = snapshotRows.map((row: any) => ({
      date: new Date(row.date).toISOString().split('T')[0],
      itemsStarted: Number(row.items_started) || 0,
      itemsFinished: Number(row.items_finished) || 0,
      itemsInQueue: Number(row.items_in_queue) || 0,
      itemsInTest: Number(row.items_in_test) || 0,
      itemsWaitingForResearch: Number(row.items_waiting_for_research) || 0,
      itemsInResearch: Number(row.items_in_research) || 0,
    }));

    // --- GAP FILLING & LIVE DATA LOGIC ---
    const results: any[] = [];
    const dateMap = new Map(trends.map((t: any) => [t.date, t]));

    const toYMD = (d: Date) => d.toISOString().split('T')[0];

    let currentDate = new Date(start);
    const lastDate = new Date(end);

    currentDate.setHours(0, 0, 0, 0);
    lastDate.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toYMD(today);

    let lastKnownValues = {
      itemsStarted: 0,
      itemsFinished: 0,
      itemsInQueue: 0,
      itemsInTest: 0,
      itemsWaitingForResearch: 0,
      itemsInResearch: 0
    };

    while (currentDate <= lastDate) {
      const dateStr = toYMD(currentDate);

      if (dateStr === todayStr && suffix === "_daily") {
        // --- LIVE DATA FOR TODAY (via MetricsService) ---
        const liveData = await MetricsService.getLiveSystemStats(prisma, {
          customerId,
          shipmentId,
          itemTypeId,
          testStationId,
        });

        results.push({
          date: dateStr,
          itemsStarted: liveData.itemsActive,
          itemsFinished: liveData.itemsFinished,
          itemsInQueue: liveData.itemsInQueue,
          itemsInTest: liveData.itemsInTest,
          itemsWaitingForResearch: liveData.itemsWaitingForResearch,
          itemsInResearch: liveData.itemsInResearch,
          isToday: true,
        });

        lastKnownValues = results[results.length - 1];

      } else if (dateMap.has(dateStr)) {
        const snap = dateMap.get(dateStr) as typeof lastKnownValues;
        results.push(snap);
        lastKnownValues = snap;
      } else {
        results.push({
          date: dateStr,
          ...lastKnownValues
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return NextResponse.json(results);
  } catch (error: any) {
    console.error("Error fetching daily trends:", error);
    return NextResponse.json(
      { error: "Failed to fetch daily trends", details: error.message },
      { status: 500 }
    );
  }
}
