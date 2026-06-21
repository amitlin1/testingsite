import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ShipmentTrackingRow } from "@/types/dashboard";
import { buildDashboardFilters } from "@/app/lib/dashboard-filters";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const shipmentId = searchParams.get("shipmentId");
    const showAllHistory = searchParams.get("showAllHistory") === "true";

    // Build filters (excluding shipmentId since we handle it separately)
    const filtersForItems = buildDashboardFilters({
      searchParams: new URLSearchParams(
        Array.from(searchParams.entries()).filter(([key]) => key !== "shipmentId" && key !== "startDate" && key !== "endDate")
      ),
      startIndex: shipmentId ? 2 : 1,
      itemRef: "i.item_id",
      stationRef: "ir.test_station_id",
      workerRef: null,
      showAllHistory,
    });

    let shipmentFilter = "";
    const queryParams: any[] = [];
    if (shipmentId) {
      shipmentFilter = "AND s.id = $1::int";
      queryParams.push(parseInt(shipmentId, 10));
    } else if (!showAllHistory) {
      shipmentFilter += " AND s.is_sent = false";
    }

    const mapRow = (row: any): ShipmentTrackingRow => {
      const totalItems = Number(row.total_items) || 0;
      const itemsInQueue = Number(row.items_in_queue) || 0;
      const itemsInTest = Number(row.items_in_test) || 0;
      const itemsWaitingForResearch = Number(row.items_waiting_for_research) || 0;
      const itemsInResearch = Number(row.items_in_research) || 0;
      const itemsFinished = Number(row.items_finished) || 0;
      const itemsInRoutes = Number(row.items_in_routes) || 0;

      const completionPercentage = itemsInRoutes > 0
        ? Math.round((itemsFinished / itemsInRoutes) * 100)
        : 0;

      const itemsInRoutesPercentage = totalItems > 0
        ? Math.round((itemsInRoutes / totalItems) * 100)
        : 0;

      return {
        shipmentId: row.shipment_id,
        shipmentCode: row.shipment_code,
        shipmentDate: row.shipment_date,
        customerCode: row.customer_code,
        customerName: row.customer_name,
        totalItems,
        itemsInQueue,
        itemsInTest,
        itemsWaitingForResearch,
        itemsInResearch,
        itemsFinished,
        itemsInRoutes,
        completionPercentage,
        itemsInRoutesPercentage,
      };
    };

    if (shipmentId) {
      const query = `
        SELECT
          s.id AS shipment_id,
          s.shipment_code,
          s.shipment_date,
          c.customer_code,
          c.name AS customer_name,
          s.amount AS total_items,
          COALESCE(item_counts.items_in_queue, 0) AS items_in_queue,
          COALESCE(item_counts.items_in_test, 0) AS items_in_test,
          COALESCE(item_counts.items_waiting_for_research, 0) AS items_waiting_for_research,
          COALESCE(item_counts.items_in_research, 0) AS items_in_research,
          COALESCE(item_counts.items_finished, 0) AS items_finished,
          COALESCE(item_counts.items_in_routes, 0) AS items_in_routes
        FROM shipments s
        JOIN customers c ON s.customer_id = c.id
        LEFT JOIN (
          SELECT
            i.shipment_id,
            COUNT(DISTINCT CASE WHEN ir.current_status = 2 THEN i.item_id END) AS items_in_queue,
            COUNT(DISTINCT CASE WHEN ir.current_status = 1 THEN i.item_id END) AS items_in_test,
            COUNT(DISTINCT CASE WHEN ir.current_status = 4 THEN i.item_id END) AS items_waiting_for_research,
            COUNT(DISTINCT CASE WHEN ir.current_status = 5 THEN i.item_id END) AS items_in_research,
            COUNT(DISTINCT CASE WHEN ir.current_status = 3 THEN i.item_id END) AS items_finished,
            COUNT(DISTINCT ir.item_id) AS items_in_routes
          FROM items i
          LEFT JOIN item_routes ir ON ir.item_id = i.item_id
          WHERE i.shipment_id = $1::int
            ${filtersForItems.conditions}
          GROUP BY i.shipment_id
        ) item_counts ON item_counts.shipment_id = s.id
        WHERE 1=1
          ${shipmentFilter}
          ${!showAllHistory ? "AND COALESCE(item_counts.items_in_routes, 0) > 0" : ""}
        ORDER BY s.shipment_date DESC
      `;

      queryParams.push(...filtersForItems.params);

      console.log("=== Shipments API Debug (with shipmentId filter) ===");
      console.log("shipmentId filter:", shipmentId);
      console.log("Query params:", queryParams);
      console.log("Full query:", query);
      console.log("===========================");

      const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);
      return NextResponse.json(rows.map(mapRow));
    }

    // Original query when NOT filtering by specific shipmentId
    const query = `
      SELECT
        s.id AS shipment_id,
        s.shipment_code,
        s.shipment_date,
        c.customer_code,
        c.name AS customer_name,
        s.amount AS total_items,
        COUNT(DISTINCT CASE WHEN ir.current_status = 2 THEN i.item_id END) AS items_in_queue,
        COUNT(DISTINCT CASE WHEN ir.current_status = 1 THEN i.item_id END) AS items_in_test,
        COUNT(DISTINCT CASE WHEN ir.current_status = 4 THEN i.item_id END) AS items_waiting_for_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 5 THEN i.item_id END) AS items_in_research,
        COUNT(DISTINCT CASE WHEN ir.current_status = 3 THEN i.item_id END) AS items_finished,
        COUNT(DISTINCT ir.item_id) AS items_in_routes
      FROM shipments s
      JOIN customers c ON s.customer_id = c.id
      LEFT JOIN items i ON i.shipment_id = s.id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      WHERE 1=1
        ${shipmentFilter}
        ${filtersForItems.conditions}
      GROUP BY s.id, s.shipment_code, s.shipment_date, s.amount, c.customer_code, c.name
      HAVING 1=1
      ${!showAllHistory ? "AND COUNT(DISTINCT ir.item_id) > 0" : ""}
      ORDER BY s.shipment_date DESC
    `;

    queryParams.push(...filtersForItems.params);

    console.log("=== Shipments API Debug ===");
    console.log("shipmentId filter:", shipmentId);
    console.log("shipmentFilter:", shipmentFilter);
    console.log("Query params:", queryParams);
    console.log("Full query:", query);
    console.log("===========================");

    const rows = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams);
    return NextResponse.json(rows.map(mapRow));
  } catch (error) {
    console.error("Error fetching shipment tracking data:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipment tracking data" },
      { status: 500 }
    );
  }
}
