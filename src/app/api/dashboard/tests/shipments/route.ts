// Shipment progress: Q7 (§5.8) by shipment — a state query, no window.
//
// `shipments.amount` is an INVENTORY number and never the denominator of tested
// work (§5.8, §2.7): completion = finished_runs / routed_runs (one formula with
// customers and item types); coverage = routed_units / amount is a separate
// number under a separate name. Both are NULL when their denominator is 0 —
// "0%" would be a claim about work nobody asked for.
//
// Two clocks, two turnarounds: the route turnaround (opened → closed, per run)
// and the ship turnaround (receipt → despatch, from `shipments`) are different
// measurements and are named differently.

import { prisma } from "@/lib/db";
import type { ShipmentWire } from "@/app/lib/dashboard/contract";
import { qualify, selectEntity, unhonoured } from "@/app/lib/metrics/read/filters";
import { entityProgress } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

/** Milliseconds, or -Infinity for a shipment with no date, so it sorts last. */
function sortableDate(v: unknown): number {
  if (v === null || v === undefined) return Number.NEGATIVE_INFINITY;
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export const GET = metricsRoute("none", "Failed to fetch shipment tracking data", async ({ filters, searchParams }) => {
  // The row carries the bare list (the table is where a reader meets the
  // number); the header carries it qualified, plus the date range: the page
  // sends one and Q7 has no window.
  const ignored = unhonoured("entityProgress", filters);
  const dated = searchParams.get("startDate") || searchParams.get("endDate");

  const rows = await entityProgress(prisma, "shipment", filters);

  // A shipment has one customer, so customerId identifies it too; the rest
  // narrow the runs inside a row.
  const shipments = selectEntity(selectEntity(rows, filters.shipmentId), filters.customerId, (r) => r.customer_id)
    .map(
      (r) =>
        ({
          shipmentId: r.entity_id,
          shipmentCode: r.entity_code ?? "",
          // Timestamp(6) without a zone (§7.1), serialised as the client has
          // always received it.
          shipmentDate: r.shipment_date as unknown as string | null,
          customerCode: r.customer_code ?? "",
          customerName: r.customer_name ?? "",
          totalItems: r.declared_amount ?? 0,
          itemsInQueue: r.in_queue,
          itemsInTest: r.in_test,
          itemsWaitingForResearch: r.waiting_research,
          itemsInResearch: r.in_research,
          itemsFinished: r.finished,
          itemsInRoutes: r.routed_runs,
          completionPercentage: r.completion_pct,
          itemsInRoutesPercentage: r.coverage_pct,
          _new_routedUnits: r.routed_units,
          _new_finishedRuns: r.finished_runs,
          _new_routeTurnaroundWallMinutes: r.avg_route_turnaround_wall_min ?? null,
          _new_routeTurnaroundWorkMinutes: r.avg_route_turnaround_work_min ?? null,
          _new_shipTurnaroundWallMinutes: r.ship_turnaround_wall_min ?? null,
          _new_shipTurnaroundWorkMinutes: r.ship_turnaround_work_min ?? null,
          _new_ignoredFilters: ignored.join(",") || null,
        }) satisfies ShipmentWire,
    )
    // Newest shipment first, compared as an instant: shipment_date arrives as a
    // Date, and String(date) sorted as text orders by WEEKDAY NAME.
    .sort((a, b) => sortableDate(b.shipmentDate) - sortableDate(a.shipmentDate));

  return {
    body: shipments,
    filters,
    ignored: qualify("entityProgress", [...ignored, ...(dated ? ["dateRange"] : [])]),
  };
});
