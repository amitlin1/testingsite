import { NextResponse } from "next/server";
import { prisma, TransactionClient } from "@/app/lib/prisma";
import { MetricsService } from "@/app/lib/dashboard/metrics-service";

import { cronSecretGuard } from "@/lib/auth/cron-secret";

export const runtime = "nodejs";

/**
 * POST /api/cron/create-daily-snapshots
 *
 * Creates/updates daily snapshots for the current date using UPSERT (ON CONFLICT DO UPDATE).
 * This prevents data gaps if the job crashes mid-run (unlike DELETE+INSERT).
 *
 * Uses MetricsService for consistent metric calculations across the app.
 *
 * Tables:
 * - shipment_snapshots
 * - customer_snapshots
 * - station_snapshots
 * - item_type_snapshots
 * - status_distribution_snapshots
 * - kpi_snapshots
 * - system_snapshots
 */
export async function POST(req: Request) {
  const denied = cronSecretGuard(req);
  if (denied) return denied;
  try {
    // Snapshot targets YESTERDAY — if the cron runs at 00:30, we want
    // the full previous day's "items processed" count, not today's empty one.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    const results = await prisma.$transaction(
      async (tx: TransactionClient) => {
        const res: { [key: string]: number } = {
          shipment_snapshots: 0,
          customer_snapshots: 0,
          station_snapshots: 0,
          item_type_snapshots: 0,
          status_distribution_snapshots: 0,
          kpi_snapshots: 0,
          system_snapshots: 0,
        };

        // =====================================================
        // 1. Shipment Snapshots (UPSERT)
        // =====================================================
        const shipments = await MetricsService.getShipmentStats(tx);
        for (const s of shipments) {
          await tx.$executeRawUnsafe(
            `INSERT INTO shipment_snapshots (
              snapshot_date, shipment_id, shipment_code, shipment_date,
              customer_id, customer_code, customer_name, total_items,
              items_in_queue, items_in_test, items_waiting_for_research,
              items_in_research, items_finished, items_in_routes,
              completion_percentage, items_in_routes_percentage
            ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (snapshot_date, shipment_id) DO UPDATE SET
              shipment_code = EXCLUDED.shipment_code,
              shipment_date = EXCLUDED.shipment_date,
              customer_id = EXCLUDED.customer_id,
              customer_code = EXCLUDED.customer_code,
              customer_name = EXCLUDED.customer_name,
              total_items = EXCLUDED.total_items,
              items_in_queue = EXCLUDED.items_in_queue,
              items_in_test = EXCLUDED.items_in_test,
              items_waiting_for_research = EXCLUDED.items_waiting_for_research,
              items_in_research = EXCLUDED.items_in_research,
              items_finished = EXCLUDED.items_finished,
              items_in_routes = EXCLUDED.items_in_routes,
              completion_percentage = EXCLUDED.completion_percentage,
              items_in_routes_percentage = EXCLUDED.items_in_routes_percentage`,
            dateStr,
            s.shipmentId,
            s.shipmentCode,
            s.shipmentDate,
            s.customerId,
            s.customerCode,
            s.customerName,
            s.totalItems,
            s.itemsInQueue,
            s.itemsInTest,
            s.itemsWaitingForResearch,
            s.itemsInResearch,
            s.itemsFinished,
            s.itemsInRoutes,
            s.completionPercentage,
            s.itemsInRoutesPercentage
          );
        }
        res.shipment_snapshots = shipments.length;

        // =====================================================
        // 2. Customer Snapshots (UPSERT)
        // =====================================================
        const customers = await MetricsService.getCustomerSnapshotStats(tx);
        for (const c of customers) {
          await tx.$executeRawUnsafe(
            `INSERT INTO customer_snapshots (
              snapshot_date, customer_id, customer_code, customer_name,
              total_items, items_in_queue, items_in_test,
              items_waiting_for_research, items_in_research, finished_items,
              items_in_routes, success_percentage, items_in_routes_percentage,
              average_time_minutes
            ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (snapshot_date, customer_id) DO UPDATE SET
              customer_code = EXCLUDED.customer_code,
              customer_name = EXCLUDED.customer_name,
              total_items = EXCLUDED.total_items,
              items_in_queue = EXCLUDED.items_in_queue,
              items_in_test = EXCLUDED.items_in_test,
              items_waiting_for_research = EXCLUDED.items_waiting_for_research,
              items_in_research = EXCLUDED.items_in_research,
              finished_items = EXCLUDED.finished_items,
              items_in_routes = EXCLUDED.items_in_routes,
              success_percentage = EXCLUDED.success_percentage,
              items_in_routes_percentage = EXCLUDED.items_in_routes_percentage,
              average_time_minutes = EXCLUDED.average_time_minutes`,
            dateStr,
            c.customerId,
            c.customerCode,
            c.customerName,
            c.totalItems,
            c.itemsInQueue,
            c.itemsInTest,
            c.itemsWaitingForResearch,
            c.itemsInResearch,
            c.finishedItems,
            c.itemsInRoutes,
            c.successPercentage,
            c.itemsInRoutesPercentage,
            c.averageTimeMinutes
          );
        }
        res.customer_snapshots = customers.length;

        // =====================================================
        // 3. Station Snapshots (UPSERT)
        // =====================================================
        const stations = await MetricsService.getStationSnapshotStats(tx, dateStr);
        for (const st of stations) {
          await tx.$executeRawUnsafe(
            `INSERT INTO station_snapshots (
              snapshot_date, station_id, station_name, station_type_name,
              items_in_queue, items_in_test, average_current_queue_time_minutes,
              total_processed_in_period
            ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (snapshot_date, station_id) DO UPDATE SET
              station_name = EXCLUDED.station_name,
              station_type_name = EXCLUDED.station_type_name,
              items_in_queue = EXCLUDED.items_in_queue,
              items_in_test = EXCLUDED.items_in_test,
              average_current_queue_time_minutes = EXCLUDED.average_current_queue_time_minutes,
              total_processed_in_period = EXCLUDED.total_processed_in_period`,
            dateStr,
            st.stationId,
            st.stationName,
            st.stationTypeName,
            st.itemsInQueue,
            st.itemsInTest,
            st.averageCurrentQueueTimeMinutes,
            st.totalProcessedInPeriod
          );
        }
        res.station_snapshots = stations.length;

        // =====================================================
        // 4. Item Type Snapshots (UPSERT)
        // =====================================================
        const itemTypes = await MetricsService.getItemTypeStats(tx);
        for (const it of itemTypes) {
          await tx.$executeRawUnsafe(
            `INSERT INTO item_type_snapshots (
              snapshot_date, item_type_id, item_type_desc, total_items,
              items_in_queue, items_in_test, items_waiting_for_research,
              items_in_research, items_finished, items_in_routes,
              completion_percentage, items_in_routes_percentage
            ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (snapshot_date, item_type_id) DO UPDATE SET
              item_type_desc = EXCLUDED.item_type_desc,
              total_items = EXCLUDED.total_items,
              items_in_queue = EXCLUDED.items_in_queue,
              items_in_test = EXCLUDED.items_in_test,
              items_waiting_for_research = EXCLUDED.items_waiting_for_research,
              items_in_research = EXCLUDED.items_in_research,
              items_finished = EXCLUDED.items_finished,
              items_in_routes = EXCLUDED.items_in_routes,
              completion_percentage = EXCLUDED.completion_percentage,
              items_in_routes_percentage = EXCLUDED.items_in_routes_percentage`,
            dateStr,
            it.itemTypeId,
            it.itemTypeDesc,
            it.totalItems,
            it.itemsInQueue,
            it.itemsInTest,
            it.itemsWaitingForResearch,
            it.itemsInResearch,
            it.itemsFinished,
            it.itemsInRoutes,
            it.completionPercentage,
            it.itemsInRoutesPercentage
          );
        }
        res.item_type_snapshots = itemTypes.length;

        // =====================================================
        // 5. Status Distribution Snapshots (UPSERT)
        // =====================================================
        const statusDist = await MetricsService.getStatusDistribution(tx);
        for (const sd of statusDist) {
          await tx.$executeRawUnsafe(
            `INSERT INTO status_distribution_snapshots (
              snapshot_date, status_id, status_name, count, percentage
            ) VALUES ($1::date, $2, $3, $4, $5)
            ON CONFLICT (snapshot_date, status_id) DO UPDATE SET
              status_name = EXCLUDED.status_name,
              count = EXCLUDED.count,
              percentage = EXCLUDED.percentage`,
            dateStr,
            sd.statusId,
            sd.statusName,
            sd.count,
            sd.percentage
          );
        }
        res.status_distribution_snapshots = statusDist.length;

        // =====================================================
        // 6. KPI Snapshots (UPSERT)
        // =====================================================
        const kpi = await MetricsService.getKpiStats(tx, dateStr);
        await tx.$executeRawUnsafe(
          `INSERT INTO kpi_snapshots (
            snapshot_date, average_queue_time_minutes, average_processing_time_minutes,
            total_items_processed, items_currently_in_queue, items_currently_in_test,
            busiest_station_id, busiest_station_name, busiest_station_count
          ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (snapshot_date) DO UPDATE SET
            average_queue_time_minutes = EXCLUDED.average_queue_time_minutes,
            average_processing_time_minutes = EXCLUDED.average_processing_time_minutes,
            total_items_processed = EXCLUDED.total_items_processed,
            items_currently_in_queue = EXCLUDED.items_currently_in_queue,
            items_currently_in_test = EXCLUDED.items_currently_in_test,
            busiest_station_id = EXCLUDED.busiest_station_id,
            busiest_station_name = EXCLUDED.busiest_station_name,
            busiest_station_count = EXCLUDED.busiest_station_count`,
          dateStr,
          kpi.averageQueueTimeMinutes,
          kpi.averageProcessingTimeMinutes,
          kpi.totalItemsProcessed,
          kpi.itemsCurrentlyInQueue,
          kpi.itemsCurrentlyInTest,
          kpi.busiestStationId,
          kpi.busiestStationName,
          kpi.busiestStationCount
        );
        res.kpi_snapshots = 1;

        // =====================================================
        // 7. System Snapshots (UPSERT)
        // =====================================================
        const sys = await MetricsService.getSystemStats(tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO system_snapshots (
            snapshot_date, total_items, items_in_queue, items_in_test,
            items_finished, items_waiting_for_research, items_in_research, items_in_routes
          ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (snapshot_date) DO UPDATE SET
            total_items = EXCLUDED.total_items,
            items_in_queue = EXCLUDED.items_in_queue,
            items_in_test = EXCLUDED.items_in_test,
            items_finished = EXCLUDED.items_finished,
            items_waiting_for_research = EXCLUDED.items_waiting_for_research,
            items_in_research = EXCLUDED.items_in_research,
            items_in_routes = EXCLUDED.items_in_routes`,
          dateStr,
          sys.totalItems,
          sys.itemsInQueue,
          sys.itemsInTest,
          sys.itemsFinished,
          sys.itemsWaitingForResearch,
          sys.itemsInResearch,
          sys.itemsInRoutes
        );
        res.system_snapshots = 1;

        // =====================================================
        // 8. Refresh Materialized View
        // =====================================================
        try {
          await MetricsService.refreshMaterializedViews(tx);
        } catch {
          // Non-critical — view refresh failure shouldn't fail the snapshot
          console.warn("Could not refresh materialized views during snapshot creation");
        }

        return res;
      },
      { timeout: 120000 }
    );

    return NextResponse.json({
      success: true,
      date: dateStr,
      message: "Daily snapshots created successfully (UPSERT)",
      results,
    });
  } catch (error: any) {
    console.error("Error creating daily snapshots:", error);
    return NextResponse.json(
      {
        error: "Failed to create daily snapshots",
        message: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
