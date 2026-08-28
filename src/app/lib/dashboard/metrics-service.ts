import { prisma } from "@/app/lib/prisma";
import type { TransactionClient } from "@/app/lib/prisma";
import { buildDashboardFilters } from "@/app/lib/dashboard-filters";
import { getStatusName } from "@/app/lib/status-names";

/**
 * Centralized Metrics Service — Single Source of Truth
 *
 * All metric calculations live here. Cron jobs, Dashboard APIs,
 * and Settings pages call these methods to ensure consistency.
 *
 * Status reference:
 *   1 = In Test, 2 = In Queue, 3 = Finished,
 *   4 = Waiting for Research, 5 = In Research
 */

// ─── Types ───────────────────────────────────────────────────

export interface StationStats {
  stationId: number;
  stationName: string;
  stationTypeName: string | null;
  itemsInQueue: number;
  itemsInTest: number;
  averageCurrentQueueTimeMinutes: number | null;
  totalProcessedInPeriod: number;
}

export interface CustomerStats {
  customerId: number;
  customerCode: string;
  customerName: string;
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  finishedItems: number;
  itemsInRoutes: number;
  successPercentage: number;
  itemsInRoutesPercentage: number;
  averageTimeMinutes: number | null;
}

export interface SystemStats {
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsFinished: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  itemsInRoutes: number;
}

export interface ShipmentStats {
  shipmentId: number;
  shipmentCode: string | null;
  shipmentDate: Date | null;
  customerId: number | null;
  customerCode: string | null;
  customerName: string | null;
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  itemsFinished: number;
  itemsInRoutes: number;
  completionPercentage: number;
  itemsInRoutesPercentage: number;
}

export interface ItemTypeStats {
  itemTypeId: number;
  itemTypeDesc: string | null;
  totalItems: number;
  itemsInQueue: number;
  itemsInTest: number;
  itemsWaitingForResearch: number;
  itemsInResearch: number;
  itemsFinished: number;
  itemsInRoutes: number;
  completionPercentage: number;
  itemsInRoutesPercentage: number;
}

export interface StatusDistributionStats {
  statusId: number;
  statusName: string | null;
  count: number;
  percentage: number;
}

export interface KpiStats {
  averageQueueTimeMinutes: number | null;
  averageProcessingTimeMinutes: number | null;
  totalItemsProcessed: number;
  itemsCurrentlyInQueue: number;
  itemsCurrentlyInTest: number;
  busiestStationId: number | null;
  busiestStationName: string | null;
  busiestStationCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────

type Client = typeof prisma | TransactionClient;

function toNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  return Number(val) || 0;
}

function toNullableNumber(val: any): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ─── Service ─────────────────────────────────────────────────

export const MetricsService = {
  /**
   * Get station stats — used by Dashboard by-station, Cron snapshots, Settings page.
   * Uses live_counters for real-time queue/test counts (O(1)),
   * history table for processed-in-period counts.
   */
  async getStationStats(
    client: Client,
    startDate: string,
    endDate: string,
    options?: {
      stationId?: number;
      stationTypeId?: number;
      customerId?: number;
      shipmentId?: number;
      itemTypeId?: number;
      itemSerial?: string;
      workerId?: number;
      showAllHistory?: boolean;
    }
  ): Promise<StationStats[]> {
    const params: any[] = [startDate, endDate];
    let idx = 3;

    const stationConds: string[] = [];
    const histConds: string[] = [];
    const liveConds: string[] = [];

    if (options?.stationId) {
      stationConds.push(`AND ts.test_station_id = $${idx}::int`);
      params.push(options.stationId);
      idx++;
    }
    if (options?.stationTypeId) {
      stationConds.push(`AND ts.test_station_type_id = $${idx}::int`);
      params.push(options.stationTypeId);
      idx++;
    }

    // Item-level filters require EXISTS subqueries
    if (options?.customerId) {
      const c = `AND EXISTS (SELECT 1 FROM items i WHERE i.item_id = __REF__.item_id AND i.customer_id = $${idx}::int)`;
      histConds.push(c.replace("__REF__", "irh"));
      liveConds.push(c.replace("__REF__", "ir"));
      params.push(options.customerId);
      idx++;
    }
    if (options?.shipmentId) {
      const c = `AND EXISTS (SELECT 1 FROM items i WHERE i.item_id = __REF__.item_id AND i.shipment_id = $${idx}::int)`;
      histConds.push(c.replace("__REF__", "irh"));
      liveConds.push(c.replace("__REF__", "ir"));
      params.push(options.shipmentId);
      idx++;
    }
    if (options?.itemSerial !== undefined && options?.itemSerial !== null && options?.itemSerial !== '') {
      const c = `AND EXISTS (SELECT 1 FROM items i WHERE i.item_id = __REF__.item_id AND i.serial_no = $${idx})`;
      histConds.push(c.replace("__REF__", "irh"));
      liveConds.push(c.replace("__REF__", "ir"));
      params.push(options.itemSerial);
      idx++;
    }
    if (options?.itemTypeId) {
      const c = `AND EXISTS (SELECT 1 FROM items i WHERE i.item_id = __REF__.item_id AND i.item_type_id = $${idx}::int)`;
      histConds.push(c.replace("__REF__", "irh"));
      liveConds.push(c.replace("__REF__", "ir"));
      params.push(options.itemTypeId);
      idx++;
    }
    if (options?.workerId) {
      histConds.push(`AND irh.worker_id = $${idx}::int`);
      params.push(options.workerId);
      idx++;
    }

    // If no item-level filters, use live_counters for O(1) queue/test counts
    const hasItemFilters = !!(
      options?.customerId || options?.shipmentId || options?.itemSerial ||
      options?.itemTypeId || options?.workerId
    );

    const notSentFilter = !options?.showAllHistory
      ? `AND EXISTS (
          SELECT 1 FROM items i_fs
          JOIN shipments s_fs ON i_fs.shipment_id = s_fs.id
          WHERE i_fs.item_id = __REF__.item_id AND s_fs.is_sent = false
        )`
      : "";

    if (notSentFilter) {
      histConds.push(notSentFilter.replace("__REF__", "irh"));
      liveConds.push(notSentFilter.replace("__REF__", "ir"));
    }

    let liveStatsCte: string;
    if (hasItemFilters) {
      // Must query item_routes with filters
      liveStatsCte = `
        live_stats AS (
          SELECT
            ir.test_station_id,
            COUNT(CASE WHEN ir.current_status IN (2, 4) THEN 1 END) AS queue_count,
            COUNT(CASE WHEN ir.current_status IN (1, 5) THEN 1 END) AS test_count,
            AVG(CASE WHEN ir.current_status IN (2, 4) AND ir.queue_start_time IS NOT NULL
                THEN EXTRACT(EPOCH FROM (NOW() - ir.queue_start_time)) / 60.0
                ELSE NULL END) AS avg_queue_minutes
          FROM item_routes ir
          WHERE ir.finished_at IS NULL
            AND ir.test_station_id IN (SELECT test_station_id FROM station_base)
            ${liveConds.join(" ")}
          GROUP BY ir.test_station_id
        )`;
    } else {
      // Use O(1) live counters + compute avg queue from item_routes only when needed
      liveStatsCte = `
        live_stats AS (
          SELECT
            slc.station_id AS test_station_id,
            slc.items_in_queue AS queue_count,
            slc.items_in_test AS test_count,
            (SELECT AVG(EXTRACT(EPOCH FROM (NOW() - ir.queue_start_time)) / 60.0)
             FROM item_routes ir
             WHERE ir.test_station_id = slc.station_id
               AND ir.current_status IN (2, 4)
               AND ir.is_finished = false
               AND ir.queue_start_time IS NOT NULL
            ) AS avg_queue_minutes
          FROM station_live_counters slc
          WHERE slc.station_id IN (SELECT test_station_id FROM station_base)
        )`;
    }

    const query = `
      WITH station_base AS (
        SELECT
          ts.test_station_id,
          ts.test_station_type_id,
          TRIM(ts.test_station_desc) AS station_name,
          TRIM(tst.test_type_desc) AS station_type_name
        FROM test_stations ts
        LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
        WHERE 1=1 ${stationConds.join(" ")}
      ),
      ${liveStatsCte},
      total_processed_count AS (
        SELECT
          irh.test_station_id,
          COUNT(DISTINCT irh.log_id) AS count
        FROM item_route_history irh
        WHERE irh.processing_end_time IS NOT NULL
          AND irh.processing_end_time >= $1::timestamp
          AND irh.processing_end_time <= $2::timestamp
          ${histConds.join(" ")}
        GROUP BY irh.test_station_id
      )
      SELECT
        sb.test_station_id,
        sb.station_name,
        sb.station_type_name,
        COALESCE(ls.queue_count, 0) AS queue_count,
        COALESCE(ls.test_count, 0) AS test_count,
        ls.avg_queue_minutes,
        COALESCE(pc.count, 0) AS processed_count
      FROM station_base sb
      LEFT JOIN live_stats ls ON ls.test_station_id = sb.test_station_id
      LEFT JOIN total_processed_count pc ON pc.test_station_id = sb.test_station_id
      ORDER BY COALESCE(pc.count, 0) DESC, sb.station_name ASC
    `;

    const rows = await (client as any).$queryRawUnsafe(query, ...params);

    return (rows as any[]).map((row) => ({
      stationId: row.test_station_id,
      stationName: row.station_name,
      stationTypeName: row.station_type_name,
      itemsInQueue: toNumber(row.queue_count),
      itemsInTest: toNumber(row.test_count),
      averageCurrentQueueTimeMinutes: toNullableNumber(row.avg_queue_minutes),
      totalProcessedInPeriod: toNumber(row.processed_count),
    }));
  },

  /**
   * Get customer performance stats — used by Dashboard customer-performance, Cron snapshots.
   */
  async getCustomerPerformance(
    client: Client,
    startDate: string,
    endDate: string,
    options?: {
      itemSerial?: string;
      itemTypeId?: number;
      shipmentId?: number;
      testStationId?: number;
      testStationTypeId?: number;
      showAllHistory?: boolean;
    }
  ): Promise<CustomerStats[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let currentIndex = 1;

    const addCondition = (clause: string, value: any) => {
      conditions.push(clause.replace(/\$\?/g, `$${currentIndex}`));
      params.push(value);
      currentIndex++;
    };

    if (options?.itemSerial !== undefined && options?.itemSerial !== null && options?.itemSerial !== '') {
      addCondition(`AND i.serial_no = $?`, options.itemSerial);
    }
    if (options?.itemTypeId) {
      addCondition(`AND i.item_type_id = $?::int`, options.itemTypeId);
    }
    if (options?.shipmentId) {
      addCondition(`AND i.shipment_id = $?::int`, options.shipmentId);
    }
    if (options?.testStationId) {
      addCondition(`AND ir.test_station_id = $?::int`, options.testStationId);
    }
    if (options?.testStationTypeId) {
      addCondition(
        `AND EXISTS (SELECT 1 FROM test_stations ts_filter WHERE ts_filter.test_station_id = ir.test_station_id AND ts_filter.test_station_type_id = $?::int)`,
        options.testStationTypeId
      );
    }

    addCondition(`AND ir.created_at <= $?::timestamp`, endDate);
    addCondition(`AND (ir.finished_at >= $?::timestamp OR ir.finished_at IS NULL)`, startDate);

    const query = `
      SELECT
        c.id AS customer_id,
        RTRIM(c.customer_code) AS customer_code,
        c.name AS customer_name,
        COUNT(DISTINCT i.item_id) AS total_items,
        COUNT(DISTINCT CASE WHEN ir.current_status = 2 THEN i.item_id END) AS items_in_queue,
        COUNT(DISTINCT CASE WHEN ir.current_status = 1 THEN i.item_id END) AS items_in_test,
        COUNT(DISTINCT CASE WHEN ir.current_status = 4 THEN i.item_id END) AS items_waiting_for_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 5 THEN i.item_id END) AS items_in_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 3 THEN i.item_id END) AS finished_items,
        COUNT(DISTINCT ir.item_id) AS items_in_routes,
        AVG(
          CASE
            WHEN ir.finished_at IS NOT NULL AND ir.created_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (ir.finished_at - ir.created_at)) / 60.0
            ELSE NULL
          END
        ) AS avg_time_minutes
      FROM customers c
      JOIN items i ON i.customer_id = c.id
      JOIN shipments s ON s.id = i.shipment_id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      WHERE 1=1
        ${conditions.join(" ")}
        ${!options?.showAllHistory ? "AND s.is_sent = false" : ""}
      GROUP BY c.id, c.customer_code, c.name
      HAVING COUNT(DISTINCT i.item_id) > 0
      ORDER BY finished_items DESC, total_items DESC
    `;

    const rows = await (client as any).$queryRawUnsafe(query, ...params);

    return (rows as any[]).map((row) => {
      const totalItems = toNumber(row.total_items);
      const finishedItems = toNumber(row.finished_items);
      const itemsInRoutes = toNumber(row.items_in_routes);

      return {
        customerId: row.customer_id,
        customerCode: row.customer_code,
        customerName: row.customer_name,
        totalItems,
        itemsInQueue: toNumber(row.items_in_queue),
        itemsInTest: toNumber(row.items_in_test),
        itemsWaitingForResearch: toNumber(row.items_waiting_for_research),
        itemsInResearch: toNumber(row.items_in_research),
        finishedItems,
        itemsInRoutes,
        successPercentage: itemsInRoutes > 0 ? Math.round((finishedItems / itemsInRoutes) * 100) : 0,
        itemsInRoutesPercentage: totalItems > 0 ? Math.round((itemsInRoutes / totalItems) * 100) : 0,
        averageTimeMinutes: toNullableNumber(row.avg_time_minutes),
      };
    });
  },

  /**
   * Get system-level stats — used by Cron system_snapshots.
   */
  async getSystemStats(client: Client): Promise<SystemStats> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        COUNT(DISTINCT i.item_id) AS total_items,
        COALESCE(SUM(CASE WHEN ir.current_status = 2 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_queue,
        COALESCE(SUM(CASE WHEN ir.current_status = 1 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_test,
        COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0) AS items_finished,
        COALESCE(SUM(CASE WHEN ir.current_status = 4 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_waiting_for_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 5 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_research,
        COUNT(ir.item_id) AS items_in_routes
      FROM items i
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    `);

    const row = (rows as any[])[0] || {};
    return {
      totalItems: toNumber(row.total_items),
      itemsInQueue: toNumber(row.items_in_queue),
      itemsInTest: toNumber(row.items_in_test),
      itemsFinished: toNumber(row.items_finished),
      itemsWaitingForResearch: toNumber(row.items_waiting_for_research),
      itemsInResearch: toNumber(row.items_in_research),
      itemsInRoutes: toNumber(row.items_in_routes),
    };
  },

  /**
   * Get shipment stats — used by Cron shipment_snapshots.
   */
  async getShipmentStats(client: Client): Promise<ShipmentStats[]> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        s.id AS shipment_id,
        s.shipment_code,
        s.shipment_date,
        s.customer_id,
        RTRIM(c.customer_code) AS customer_code,
        c.name AS customer_name,
        s.amount AS total_items,
        COALESCE(SUM(CASE WHEN ir.current_status = 2 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_queue,
        COALESCE(SUM(CASE WHEN ir.current_status = 1 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_test,
        COALESCE(SUM(CASE WHEN ir.current_status = 4 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_waiting_for_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 5 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0) AS items_finished,
        COUNT(ir.item_id) AS items_in_routes,
        CASE WHEN s.amount > 0
          THEN ROUND((COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0)::DECIMAL / s.amount) * 100, 2)
          ELSE 0 END AS completion_percentage,
        CASE WHEN s.amount > 0
          THEN ROUND((COUNT(ir.item_id)::DECIMAL / s.amount) * 100, 2)
          ELSE 0 END AS items_in_routes_percentage
      FROM shipments s
      JOIN customers c ON c.id = s.customer_id
      LEFT JOIN items i ON i.shipment_id = s.id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      GROUP BY s.id, s.shipment_code, s.shipment_date, s.customer_id, c.customer_code, c.name, s.amount
    `);

    return (rows as any[]).map((row) => ({
      shipmentId: row.shipment_id,
      shipmentCode: row.shipment_code,
      shipmentDate: row.shipment_date,
      customerId: row.customer_id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      totalItems: toNumber(row.total_items),
      itemsInQueue: toNumber(row.items_in_queue),
      itemsInTest: toNumber(row.items_in_test),
      itemsWaitingForResearch: toNumber(row.items_waiting_for_research),
      itemsInResearch: toNumber(row.items_in_research),
      itemsFinished: toNumber(row.items_finished),
      itemsInRoutes: toNumber(row.items_in_routes),
      completionPercentage: toNumber(row.completion_percentage),
      itemsInRoutesPercentage: toNumber(row.items_in_routes_percentage),
    }));
  },

  /**
   * Get customer snapshot stats — used by Cron customer_snapshots.
   */
  async getCustomerSnapshotStats(client: Client): Promise<{
    customerId: number;
    customerCode: string;
    customerName: string;
    totalItems: number;
    itemsInQueue: number;
    itemsInTest: number;
    itemsWaitingForResearch: number;
    itemsInResearch: number;
    finishedItems: number;
    itemsInRoutes: number;
    successPercentage: number;
    itemsInRoutesPercentage: number;
    averageTimeMinutes: number | null;
  }[]> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        c.id AS customer_id,
        RTRIM(c.customer_code) AS customer_code,
        c.name AS customer_name,
        COUNT(DISTINCT i.item_id) AS total_items,
        COALESCE(SUM(CASE WHEN ir.current_status = 2 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_queue,
        COALESCE(SUM(CASE WHEN ir.current_status = 1 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_test,
        COALESCE(SUM(CASE WHEN ir.current_status = 4 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_waiting_for_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 5 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0) AS finished_items,
        COUNT(ir.item_id) AS items_in_routes,
        CASE WHEN COUNT(ir.item_id) > 0
          THEN ROUND((COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0)::DECIMAL / COUNT(ir.item_id)) * 100, 2)
          ELSE 0 END AS success_percentage,
        CASE WHEN COUNT(DISTINCT i.item_id) > 0
          THEN ROUND((COUNT(ir.item_id)::DECIMAL / COUNT(DISTINCT i.item_id)) * 100, 2)
          ELSE 0 END AS items_in_routes_percentage,
        AVG(CASE WHEN ir.finished_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (ir.finished_at - ir.created_at)) / 60
          ELSE NULL END) AS average_time_minutes
      FROM customers c
      JOIN items i ON i.customer_id = c.id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      GROUP BY c.id, c.customer_code, c.name
    `);

    return (rows as any[]).map((row) => ({
      customerId: row.customer_id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      totalItems: toNumber(row.total_items),
      itemsInQueue: toNumber(row.items_in_queue),
      itemsInTest: toNumber(row.items_in_test),
      itemsWaitingForResearch: toNumber(row.items_waiting_for_research),
      itemsInResearch: toNumber(row.items_in_research),
      finishedItems: toNumber(row.finished_items),
      itemsInRoutes: toNumber(row.items_in_routes),
      successPercentage: toNumber(row.success_percentage),
      itemsInRoutesPercentage: toNumber(row.items_in_routes_percentage),
      averageTimeMinutes: toNullableNumber(row.average_time_minutes),
    }));
  },

  /**
   * Get station snapshot stats — used by Cron station_snapshots.
   */
  async getStationSnapshotStats(client: Client, dateStr: string): Promise<{
    stationId: number;
    stationName: string;
    stationTypeName: string | null;
    itemsInQueue: number;
    itemsInTest: number;
    averageCurrentQueueTimeMinutes: number | null;
    totalProcessedInPeriod: number;
  }[]> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        ts.test_station_id AS station_id,
        RTRIM(ts.test_station_desc) AS station_name,
        RTRIM(tst.test_type_desc) AS station_type_name,
        COALESCE(SUM(CASE WHEN ir.current_status = 2 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_queue,
        COALESCE(SUM(CASE WHEN ir.current_status = 1 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_test,
        AVG(CASE WHEN irh.queue_start_time IS NOT NULL AND irh.processing_start_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60
          ELSE NULL END) AS average_current_queue_time_minutes,
        COALESCE(SUM(CASE WHEN ir.finished_at::date = $1::date THEN 1 ELSE 0 END), 0) AS total_processed_in_period
      FROM test_stations ts
      LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
      LEFT JOIN item_routes ir ON ir.test_station_id = ts.test_station_id
      LEFT JOIN item_route_history irh ON irh.test_station_id = ts.test_station_id
      GROUP BY ts.test_station_id, ts.test_station_desc, tst.test_type_desc
    `, dateStr);

    return (rows as any[]).map((row) => ({
      stationId: row.station_id,
      stationName: row.station_name,
      stationTypeName: row.station_type_name,
      itemsInQueue: toNumber(row.items_in_queue),
      itemsInTest: toNumber(row.items_in_test),
      averageCurrentQueueTimeMinutes: toNullableNumber(row.average_current_queue_time_minutes),
      totalProcessedInPeriod: toNumber(row.total_processed_in_period),
    }));
  },

  /**
   * Get item type stats — used by Cron item_type_snapshots.
   */
  async getItemTypeStats(client: Client): Promise<ItemTypeStats[]> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        it.item_type_id,
        it.item_type_desc,
        COUNT(DISTINCT i.item_id) AS total_items,
        COALESCE(SUM(CASE WHEN ir.current_status = 2 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_queue,
        COALESCE(SUM(CASE WHEN ir.current_status = 1 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_test,
        COALESCE(SUM(CASE WHEN ir.current_status = 4 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_waiting_for_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 5 AND ir.is_finished = false THEN 1 ELSE 0 END), 0) AS items_in_research,
        COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0) AS items_finished,
        COUNT(ir.item_id) AS items_in_routes,
        CASE WHEN COUNT(DISTINCT i.item_id) > 0
          THEN ROUND((COALESCE(SUM(CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 1 ELSE 0 END), 0)::DECIMAL / COUNT(DISTINCT i.item_id)) * 100, 2)
          ELSE 0 END AS completion_percentage,
        CASE WHEN COUNT(DISTINCT i.item_id) > 0
          THEN ROUND((COUNT(ir.item_id)::DECIMAL / COUNT(DISTINCT i.item_id)) * 100, 2)
          ELSE 0 END AS items_in_routes_percentage
      FROM item_types it
      JOIN items i ON i.item_type_id = it.item_type_id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      GROUP BY it.item_type_id, it.item_type_desc
    `);

    return (rows as any[]).map((row) => ({
      itemTypeId: row.item_type_id,
      itemTypeDesc: row.item_type_desc,
      totalItems: toNumber(row.total_items),
      itemsInQueue: toNumber(row.items_in_queue),
      itemsInTest: toNumber(row.items_in_test),
      itemsWaitingForResearch: toNumber(row.items_waiting_for_research),
      itemsInResearch: toNumber(row.items_in_research),
      itemsFinished: toNumber(row.items_finished),
      itemsInRoutes: toNumber(row.items_in_routes),
      completionPercentage: toNumber(row.completion_percentage),
      itemsInRoutesPercentage: toNumber(row.items_in_routes_percentage),
    }));
  },

  /**
   * Get status distribution stats — used by Cron status_distribution_snapshots.
   */
  async getStatusDistribution(client: Client): Promise<StatusDistributionStats[]> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        ist.item_status_id AS status_id,
        ist.item_status_desc AS status_name,
        COALESCE(status_counts.count, 0) AS count,
        CASE WHEN total.total_count > 0
          THEN ROUND((COALESCE(status_counts.count, 0)::DECIMAL / total.total_count) * 100, 2)
          ELSE 0 END AS percentage
      FROM item_status ist
      LEFT JOIN (
        SELECT
          CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 3 ELSE ir.current_status END AS status_id,
          COUNT(*) AS count
        FROM item_routes ir
        GROUP BY CASE WHEN ir.current_status = 3 OR ir.is_finished = true THEN 3 ELSE ir.current_status END
      ) status_counts ON status_counts.status_id = ist.item_status_id
      CROSS JOIN (SELECT COUNT(*) AS total_count FROM item_routes) total
    `);

    return (rows as any[]).map((row) => ({
      statusId: row.status_id,
      statusName: row.status_name,
      count: toNumber(row.count),
      percentage: toNumber(row.percentage),
    }));
  },

  /**
   * Get KPI stats — used by Cron kpi_snapshots.
   */
  async getKpiStats(client: Client, dateStr: string): Promise<KpiStats> {
    const rows = await (client as any).$queryRawUnsafe(`
      SELECT
        AVG(CASE WHEN irh.queue_start_time IS NOT NULL AND irh.processing_start_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60
          ELSE NULL END) AS average_queue_time_minutes,
        AVG(CASE WHEN irh.processing_start_time IS NOT NULL AND irh.processing_end_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) / 60
          ELSE NULL END) AS average_processing_time_minutes,
        (SELECT COUNT(*) FROM item_routes WHERE finished_at::date = $1::date) AS total_items_processed,
        (SELECT COUNT(*) FROM item_routes WHERE current_status = 2 AND is_finished = false) AS items_currently_in_queue,
        (SELECT COUNT(*) FROM item_routes WHERE current_status = 1 AND is_finished = false) AS items_currently_in_test,
        busiest.station_id AS busiest_station_id,
        busiest.station_name AS busiest_station_name,
        COALESCE(busiest.count, 0) AS busiest_station_count
      FROM item_route_history irh
      LEFT JOIN LATERAL (
        SELECT
          ir.test_station_id AS station_id,
          RTRIM(ts.test_station_desc) AS station_name,
          COUNT(*) AS count
        FROM item_routes ir
        JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
        WHERE ir.finished_at::date = $1::date
        GROUP BY ir.test_station_id, ts.test_station_desc
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) busiest ON true
      LIMIT 1
    `, dateStr);

    const row = (rows as any[])[0] || {};
    return {
      averageQueueTimeMinutes: toNullableNumber(row.average_queue_time_minutes),
      averageProcessingTimeMinutes: toNullableNumber(row.average_processing_time_minutes),
      totalItemsProcessed: toNumber(row.total_items_processed),
      itemsCurrentlyInQueue: toNumber(row.items_currently_in_queue),
      itemsCurrentlyInTest: toNumber(row.items_currently_in_test),
      busiestStationId: row.busiest_station_id ?? null,
      busiestStationName: row.busiest_station_name ?? null,
      busiestStationCount: toNumber(row.busiest_station_count),
    };
  },

  /**
   * Refresh the materialized view for station stats.
   * Should be called periodically (every 10 minutes via cron).
   */
  async refreshMaterializedViews(client: Client): Promise<void> {
    await (client as any).$executeRawUnsafe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_station_stats`
    );
  },

  // ═══════════════════════════════════════════════════════════
  // Dashboard-specific methods (filter-aware)
  // ═══════════════════════════════════════════════════════════

  /**
   * Get status distribution — Dashboard version with date range and filters.
   */
  async getStatusDistributionFiltered(
    client: Client,
    startDate: string,
    endDate: string,
    searchParams: URLSearchParams
  ): Promise<{
    status: string;
    statusName: string;
    count: number;
    percentage: number;
  }[]> {
    const showAllHistory = searchParams.get("showAllHistory") === "true";
    const filters = buildDashboardFilters({
      searchParams,
      startIndex: 3,
      itemRef: "ir.item_id",
      stationRef: "ir.test_station_id",
      showAllHistory,
    });

    const workerId = searchParams.get("workerId");
    let joinHistory = "";
    let workerCondition = "";
    const queryParams: any[] = [startDate, endDate, ...filters.params];

    if (workerId) {
      joinHistory = `JOIN item_route_history irh ON irh.item_id = ir.item_id`;
      workerCondition = `AND irh.worker_id = $${queryParams.length + 1}::int`;
      queryParams.push(workerId);
    }

    const query = `
      SELECT
        ir.current_status,
        s.item_status_desc AS status_name,
        COUNT(DISTINCT ir.item_id) AS count
      FROM item_routes ir
      JOIN items i ON i.item_id = ir.item_id
      LEFT JOIN item_status s ON s.item_status_id = ir.current_status
      ${joinHistory}
      WHERE ir.created_at <= $2::timestamp
        AND (ir.finished_at >= $1::timestamp OR ir.finished_at IS NULL)
        ${filters.conditions}
        ${workerCondition}
      GROUP BY ir.current_status, s.item_status_desc
      ORDER BY ir.current_status
    `;

    const rows = await (client as any).$queryRawUnsafe(query, ...queryParams);
    const total = (rows as any[]).reduce((sum: number, row: any) => sum + Number(row.count || 0), 0);

    return (rows as any[]).map((row: any) => {
      const count = Number(row.count) || 0;
      const percentage = total > 0 ? Math.round((count / total) * 100 * 10) / 10 : 0;
      return {
        status: String(row.current_status || 0),
        statusName: row.status_name || getStatusName(row.current_status),
        count,
        percentage,
      };
    });
  },

  /**
   * Get item type stats — Dashboard version with filters.
   */
  async getItemTypeStatsFiltered(
    client: Client,
    searchParams: URLSearchParams
  ): Promise<{
    itemTypeId: number;
    itemTypeDesc: string;
    totalItems: number;
    itemsInQueue: number;
    itemsInTest: number;
    itemsWaitingForResearch: number;
    itemsInResearch: number;
    itemsFinished: number;
    itemsInRoutes: number;
    completionPercentage: number;
    itemsInRoutesPercentage: number;
  }[]> {
    const showAllHistory = searchParams.get("showAllHistory") === "true";

    // Build filters excluding itemTypeId since we group by it
    const filtersForItems = buildDashboardFilters({
      searchParams: new URLSearchParams(
        Array.from(searchParams.entries()).filter(([key]) => key !== "itemTypeId" && key !== "startDate" && key !== "endDate")
      ),
      startIndex: 1,
      itemRef: "ir.item_id",
      stationRef: "ir.test_station_id",
      workerRef: null,
      showAllHistory,
    });

    const query = `
      SELECT
        it.item_type_id,
        it.item_type_desc,
        COALESCE(shipment_totals.total_items, 0) AS total_items,
        COUNT(DISTINCT CASE WHEN ir.current_status = 2 THEN ir.item_id END) AS items_in_queue,
        COUNT(DISTINCT CASE WHEN ir.current_status = 1 THEN ir.item_id END) AS items_in_test,
        COUNT(DISTINCT CASE WHEN ir.current_status = 4 THEN ir.item_id END) AS items_waiting_for_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 5 THEN ir.item_id END) AS items_in_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 3 THEN ir.item_id END) AS items_finished,
        COUNT(DISTINCT ir.item_id) AS items_in_routes
      FROM item_types it
      LEFT JOIN (
        SELECT
          si.item_type_id,
          SUM(s.amount) AS total_items
        FROM shipments s
        JOIN shipment_items si ON si.shipment_id = s.id
        WHERE 1=1 ${!showAllHistory ? "AND s.is_sent = false" : ""}
        GROUP BY si.item_type_id
      ) shipment_totals ON shipment_totals.item_type_id = it.item_type_id
      LEFT JOIN item_routes ir ON ir.item_type_id = it.item_type_id
      LEFT JOIN items i ON i.item_id = ir.item_id
      WHERE 1=1
        ${filtersForItems.conditions}
      GROUP BY it.item_type_id, it.item_type_desc, shipment_totals.total_items
      HAVING 1=1
      ${!showAllHistory ? "AND COUNT(DISTINCT ir.item_id) > 0" : ""}
      ORDER BY it.item_type_desc
    `;

    const rows = await (client as any).$queryRawUnsafe(query, ...filtersForItems.params);

    return (rows as any[]).map((row: any) => {
      const totalItems = Number(row.total_items) || 0;
      const itemsFinished = Number(row.items_finished) || 0;
      const itemsInRoutes = Number(row.items_in_routes) || 0;
      const completionPercentage = itemsInRoutes > 0 ? Math.round((itemsFinished / itemsInRoutes) * 100) : 0;
      const itemsInRoutesPercentage = totalItems > 0 ? Math.round((itemsInRoutes / totalItems) * 100) : 0;

      return {
        itemTypeId: row.item_type_id,
        itemTypeDesc: row.item_type_desc,
        totalItems,
        itemsInQueue: Number(row.items_in_queue) || 0,
        itemsInTest: Number(row.items_in_test) || 0,
        itemsWaitingForResearch: Number(row.items_waiting_for_research) || 0,
        itemsInResearch: Number(row.items_in_research) || 0,
        itemsFinished,
        itemsInRoutes,
        completionPercentage,
        itemsInRoutesPercentage,
      };
    });
  },

  /**
   * Get KPI stats — Dashboard version with full filter support.
   * Includes time-window overlap calculations, workload scoring for busiest station,
   * and parallel query execution.
   */
  async getKpiStatsFiltered(
    client: Client,
    startDate: string,
    endDate: string,
    searchParams: URLSearchParams
  ): Promise<{
    averageQueueTimeMinutes: number | null;
    averageProcessingTimeMinutes: number | null;
    totalItemsProcessed: number;
    itemsCurrentlyInQueue: number;
    itemsCurrentlyInTest: number;
    busiestStationId: number | null;
    busiestStationName: string | null;
    busiestStationCount: number;
    busiestStationWorkloadScore: number;
    busiestStationBusySeconds: number;
    busiestStationWaitSeconds: number;
    avgQueueSeconds: number;
    avgProcessingSeconds: number;
    treatedCount: number;
  }> {
    const showAllHistory = searchParams.get("showAllHistory") === "true";
    const status = searchParams.get("status");

    const historyFilters = buildDashboardFilters({
      searchParams,
      startIndex: 3,
      itemRef: "irh.item_id",
      stationRef: "irh.test_station_id",
      workerRef: "irh.worker_id",
      statusRef: "ir.current_status",
      showAllHistory,
    });

    const routesFilters = buildDashboardFilters({
      searchParams,
      startIndex: 1,
      itemRef: "ir.item_id",
      stationRef: "ir.test_station_id",
      showAllHistory,
    });

    const kpiRoutesFilters = buildDashboardFilters({
      searchParams,
      startIndex: 3,
      itemRef: "ir.item_id",
      stationRef: "ir.test_station_id",
      workerRef: null,
      statusRef: "ir.current_status",
      showAllHistory,
    });

    const hasWorkerFilter = !!searchParams.get("workerId");

    const unifiedStatsQuery = `
      WITH
      hist_rows AS (
        SELECT irh.queue_start_time, irh.processing_start_time, irh.processing_end_time
        FROM item_route_history irh
        JOIN item_routes ir ON ir.item_id = irh.item_id AND ir.test_station_id = irh.test_station_id
        WHERE (irh.queue_start_time < $2::timestamp OR irh.processing_start_time < $2::timestamp)
          AND (irh.processing_end_time >= $1::timestamp OR irh.processing_end_time IS NULL)
          ${historyFilters.conditions}
      ),
      all_queue AS (
         SELECT
           EXTRACT(EPOCH FROM (LEAST(h.processing_start_time, $2::timestamp) - GREATEST(h.queue_start_time, $1::timestamp))) as sec
         FROM hist_rows h
         WHERE h.queue_start_time IS NOT NULL AND h.processing_start_time IS NOT NULL
           AND h.processing_start_time > h.queue_start_time
           AND h.processing_start_time > $1::timestamp AND h.queue_start_time < $2::timestamp
         UNION ALL
         SELECT
           EXTRACT(EPOCH FROM (LEAST(NOW(), $2::timestamp) - GREATEST(ir.queue_start_time, $1::timestamp)))
         FROM item_routes ir
         WHERE ir.current_status IN (2,4) AND ir.queue_start_time IS NOT NULL
           AND ir.queue_start_time < $2::timestamp
           ${kpiRoutesFilters.conditions}
           ${hasWorkerFilter ? "AND 1=0" : ""}
         UNION ALL
         SELECT
           EXTRACT(EPOCH FROM (LEAST(ir.processing_start_time, $2::timestamp) - GREATEST(ir.queue_start_time, $1::timestamp)))
         FROM item_routes ir
         WHERE ir.current_status IN (1,5) AND ir.queue_start_time IS NOT NULL AND ir.processing_start_time IS NOT NULL
           AND ir.processing_start_time > ir.queue_start_time
           AND ir.processing_start_time > $1::timestamp AND ir.queue_start_time < $2::timestamp
           ${kpiRoutesFilters.conditions}
           ${hasWorkerFilter ? "AND 1=0" : ""}
      ),
      all_proc AS (
         SELECT
           EXTRACT(EPOCH FROM (LEAST(h.processing_end_time, $2::timestamp) - GREATEST(h.processing_start_time, $1::timestamp))) as sec
         FROM hist_rows h
         WHERE h.processing_start_time IS NOT NULL AND h.processing_end_time IS NOT NULL
           AND h.processing_end_time > h.processing_start_time
           AND h.processing_end_time > $1::timestamp AND h.processing_start_time < $2::timestamp
         UNION ALL
         SELECT
           EXTRACT(EPOCH FROM (LEAST(NOW(), $2::timestamp) - GREATEST(ir.processing_start_time, $1::timestamp)))
         FROM item_routes ir
         WHERE ir.current_status IN (1,5) AND ir.processing_start_time IS NOT NULL
           AND ir.processing_start_time < $2::timestamp
           ${kpiRoutesFilters.conditions}
           ${hasWorkerFilter ? "AND 1=0" : ""}
      )
      SELECT
        (SELECT AVG(sec) FROM all_queue WHERE sec > 0) as avg_queue_sec,
        (SELECT AVG(sec) FROM all_proc WHERE sec > 0) as avg_proc_sec,
        (SELECT COUNT(DISTINCT ir.item_id) FROM item_routes ir
         WHERE ir.finished_at IS NOT NULL
           AND ir.finished_at >= $1::timestamp AND ir.finished_at <= $2::timestamp
           ${kpiRoutesFilters.conditions}
           ${hasWorkerFilter ? "AND 1=0" : ""}
        ) as treated_count
    `;

    const showQueue = !status || status === "all" || status === "queue";
    const itemsInQueueQuery = `
      SELECT COUNT(*) AS total
      FROM item_routes ir
      WHERE ir.current_status = 2
        AND ir.finished_at IS NULL
        ${routesFilters.conditions}
    `;

    const showTest = !status || status === "all" || status === "processing";
    const itemsInTestQuery = `
      SELECT COUNT(*) AS total
      FROM item_routes ir
      WHERE ir.current_status = 1
        AND ir.finished_at IS NULL
        ${routesFilters.conditions}
    `;

    const mostBusyStationQuery = `
      WITH
      hist_calc AS (
        SELECT
            irh.test_station_id,
            GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(irh.processing_end_time, $2::timestamp) -
                GREATEST(irh.processing_start_time, $1::timestamp)
            ))) as busy_sec,
            GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(irh.processing_start_time, $2::timestamp) -
                GREATEST(irh.queue_start_time, $1::timestamp)
            ))) as wait_sec
        FROM item_route_history irh
        JOIN item_routes ir ON ir.item_id = irh.item_id AND ir.test_station_id = irh.test_station_id
        WHERE irh.processing_start_time IS NOT NULL
          AND (irh.queue_start_time <= $2::timestamp OR irh.processing_start_time <= $2::timestamp)
          AND (irh.processing_end_time >= $1::timestamp OR irh.processing_end_time IS NULL)
          ${historyFilters.conditions}
      ),
      live_calc AS (
        SELECT
            ir.test_station_id,
            CASE WHEN ir.current_status IN (2, 4) AND ir.queue_start_time IS NOT NULL THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(NOW(), $2::timestamp) -
                    GREATEST(ir.queue_start_time, $1::timestamp)
                )))
            WHEN ir.current_status IN (1, 5) AND ir.processing_start_time IS NOT NULL THEN
                GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(ir.processing_start_time, $2::timestamp) -
                    GREATEST(ir.queue_start_time, $1::timestamp)
                )))
            ELSE 0 END as wait_sec,
            CASE WHEN ir.current_status IN (1, 5) AND ir.processing_start_time IS NOT NULL THEN
                 GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(NOW(), $2::timestamp) -
                    GREATEST(ir.processing_start_time, $1::timestamp)
                )))
            ELSE 0 END as busy_sec
        FROM item_routes ir
        WHERE ir.test_station_id IS NOT NULL
          AND ir.finished_at IS NULL
          ${kpiRoutesFilters.conditions}
          ${hasWorkerFilter ? "AND 1=0" : ""}
      ),
      scores AS (
         SELECT
             test_station_id,
             SUM(busy_sec) as total_busy,
             SUM(wait_sec) as total_wait,
             (SUM(busy_sec) + 0.3 * SUM(wait_sec)) as workload_score
         FROM (
           SELECT test_station_id, busy_sec, wait_sec FROM hist_calc
           UNION ALL
           SELECT test_station_id, busy_sec, wait_sec FROM live_calc
         ) combined
         GROUP BY test_station_id
      )
      SELECT
         s.test_station_id AS station_id,
         TRIM(ts.test_station_desc) AS station_name,
         s.total_busy,
         s.total_wait,
         s.workload_score
      FROM scores s
      JOIN test_stations ts ON ts.test_station_id = s.test_station_id
      ORDER BY s.workload_score DESC, s.total_busy DESC, s.total_wait DESC, s.test_station_id ASC
      LIMIT 1
    `;

    const historyParams = [startDate, endDate, ...historyFilters.params];

    const [
      unifiedRows,
      itemsInQueueRows,
      itemsInTestRows,
      mostBusyStationRows,
    ] = await Promise.all([
      (client as any).$queryRawUnsafe(unifiedStatsQuery, ...historyParams),
      showQueue ? (client as any).$queryRawUnsafe(itemsInQueueQuery, ...routesFilters.params) : Promise.resolve([{ total: 0 }]),
      showTest ? (client as any).$queryRawUnsafe(itemsInTestQuery, ...routesFilters.params) : Promise.resolve([{ total: 0 }]),
      (client as any).$queryRawUnsafe(mostBusyStationQuery, ...historyParams),
    ]);

    const uRows = unifiedRows as any[];
    const qRows = itemsInQueueRows as any[];
    const tRows = itemsInTestRows as any[];
    const bRows = mostBusyStationRows as any[];

    return {
      averageQueueTimeMinutes: (parseFloat(uRows[0]?.avg_queue_sec || "0") / 60) || 0,
      averageProcessingTimeMinutes: (parseFloat(uRows[0]?.avg_proc_sec || "0") / 60) || 0,
      totalItemsProcessed: parseInt(uRows[0]?.treated_count || "0", 10),
      avgQueueSeconds: parseFloat(uRows[0]?.avg_queue_sec || "0"),
      avgProcessingSeconds: parseFloat(uRows[0]?.avg_proc_sec || "0"),
      treatedCount: parseInt(uRows[0]?.treated_count || "0", 10),
      itemsCurrentlyInQueue: parseInt(qRows[0]?.total || "0", 10),
      itemsCurrentlyInTest: parseInt(tRows[0]?.total || "0", 10),
      busiestStationId: bRows[0]?.station_id ?? null,
      busiestStationName: bRows[0]?.station_name ?? null,
      busiestStationCount: Math.round(parseFloat(bRows[0]?.workload_score || "0")),
      busiestStationWorkloadScore: parseFloat(bRows[0]?.workload_score || "0"),
      busiestStationBusySeconds: parseFloat(bRows[0]?.total_busy || "0"),
      busiestStationWaitSeconds: parseFloat(bRows[0]?.total_wait || "0"),
    };
  },

};
