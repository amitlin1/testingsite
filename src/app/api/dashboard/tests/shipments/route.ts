// GET /api/dashboard/tests/shipments — shipment progress, from the ledger.
//
// Q7 (§5.8) grouped by shipment. Stage 5 of docs/dashboard-migration-plan-v2.md.
//
// THE DENOMINATOR (§5.8, §2.7)
// ----------------------------
// `shipments.amount` is an INVENTORY number — what the customer declared they
// sent — and it is NEVER the denominator of tested work. The old route divided
// items_finished by items_in_routes for completion but divided items_in_routes
// by `amount` for the second bar, and `shipment_snapshots.completion_percentage`
// (the other consumer of this screen's numbers) froze `amount` as the
// denominator and never recovered. Here:
//
//   completionPercentage = finished_runs / routed_runs   (one formula, shared
//                          with item types and customers)
//   itemsInRoutesPercentage = coverage_pct = routed_units / amount
//                          — coverage against the declared stock, a separate
//                            number with a separate name, reported honestly.
//
// Both are computed in the SELECT. Nothing stores a ratio (§2.7).
//
// OTHER CORRECTIONS THIS CONVERSION CARRIES (§9.4)
//  - `s.is_sent = false` becomes `s.is_sent IS NOT TRUE`: is_sent is nullable
//    and raw-SQL writers bypass Prisma's default, so a NULL shipment used to
//    vanish from every live screen (§5.0(1)).
//  - the five status counts come from the ledger's open intervals per route_run
//    rather than item_routes.current_status.
//  - "finished" is a route_run closure (§5.3ב), never a sample of terminal
//    intervals.
//
// Contract: unchanged — same query string, same ShipmentTrackingRow field set.
// §2.8's second clock arrives beside every duration:
// route turnaround (opened_at -> closed_at, per item) and ship turnaround
// (receipt -> despatch, from `shipments`) are DIFFERENT measurements and are
// named differently; v1 reported the first under the second's label.

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import type { ShipmentTrackingRow } from "@/types/dashboard";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { entityProgress, entityProgressIgnored } from "@/app/lib/metrics/queries";
import { qualify } from "@/app/lib/metrics/dashboard-request";

export const runtime = "nodejs";

// completionPercentage is widened to `| null` rather than coerced with `?? 0`:
// Q7 returns NULL when nothing is routed, and "0% complete" is a claim about
// work that was never asked for. tests/kpis widened its two averages for the
// same reason — a missing number must never arrive as a real zero (§5.0).
interface ShipmentRow
  extends Omit<ShipmentTrackingRow, "completionPercentage" | "itemsInRoutesPercentage"> {
  completionPercentage: number | null;
  // Widened for the same reason: the denominator is NULLIF(s.amount, 0), so a
  // shipment that declares nothing answers NULL, and `?? 0` turned "nothing to
  // cover" into the claim "0% covered". No such shipment exists on this database
  // (0 of 77 have amount = 0) — unlike the customer and item-type screens, where
  // the same coalesce was firing — but the guard costs nothing and the three
  // screens must not disagree about what an absent denominator means.
  itemsInRoutesPercentage: number | null;
  _new_routedUnits: number;
  _new_finishedRuns: number;
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
  _new_shipTurnaroundWallMinutes: number | null;
  _new_shipTurnaroundWorkMinutes: number | null;
  _new_ignoredFilters: string | null;
}

/** Milliseconds, or -Infinity for a shipment with no date, so it sorts last. */
function sortableDate(v: unknown): number {
  if (v === null || v === undefined) return Number.NEGATIVE_INFINITY;
  const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

export const GET = withAuth(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const filters = filtersFromSearchParams(searchParams);
    // The filters Q7 cannot express. This exact list is what the row carries
    // inline (the shipment table is where a reader meets the number).
    const ignored = entityProgressIgnored(filters);
    // The header carries more: each name tagged with the query that drops it,
    // plus the date range. The page sends startDate/endDate and Q7 has no
    // window — entity progress is a state query (§5.8). The OLD route dropped
    // those two params just as silently (it filtered them out of
    // buildDashboardFilters by name); here the fact is reported.
    const ignoredHeader = qualify("entityProgress", [
      ...ignored,
      ...(searchParams.get("startDate") || searchParams.get("endDate") ? ["dateRange"] : []),
    ]);

    const rows = await entityProgress(prisma, "shipment", filters);

    // Entity-identifying filters select rows; everything else narrows the runs
    // inside a row (Q7 applies those inside the LEFT JOIN's ON, so a shipment
    // with no matching run survives as zeros instead of disappearing).
    // A shipment belongs to exactly one customer, so customerId identifies the
    // entity here just as shipmentId does.
    const wantShipment = filters.shipmentId ?? null;
    const wantCustomer = filters.customerId ?? null;

    const shipments: ShipmentRow[] = rows
      .filter(
        (r) =>
          (wantShipment === null || r.entity_id === wantShipment) &&
          (wantCustomer === null || (r.customer_id ?? null) === wantCustomer)
      )
      .map((r) => ({
        shipmentId: r.entity_id,
        shipmentCode: r.entity_code ?? "",
        // Timestamp(6) without a zone (§7.1); serialised as the client has
        // always received it.
        shipmentDate: r.shipment_date as unknown as string,
        customerCode: r.customer_code ?? "",
        customerName: r.customer_name ?? "",
        // The declared stock. Displayed, never divided into.
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
        // §2.8: two clocks, two names, never interchangeable.
        _new_routeTurnaroundWallMinutes: r.avg_route_turnaround_wall_min ?? null,
        _new_routeTurnaroundWorkMinutes: r.avg_route_turnaround_work_min ?? null,
        _new_shipTurnaroundWallMinutes: r.ship_turnaround_wall_min ?? null,
        _new_shipTurnaroundWorkMinutes: r.ship_turnaround_work_min ?? null,
        _new_ignoredFilters: ignored.join(",") || null,
      }))
      // The old route ordered by shipment_date DESC; Q7 orders by id. Compared
      // as an instant, not as a string: shipment_date arrives as a Date, and
      // String(date) is "Wed Sep 24 2025 …" — sorting that lexicographically
      // orders by WEEKDAY NAME.
      .sort((a, b) => sortableDate(b.shipmentDate) - sortableDate(a.shipmentDate));

    const headers: Record<string, string> = {
      "X-Metrics-Scope": filters.scope === "all" ? "all" : "open_shipments",
    };
    if (ignoredHeader.length > 0) {
      headers["X-Metrics-Ignored-Filters"] = ignoredHeader.join(",");
    }
    return NextResponse.json(shipments, { headers });
  } catch (error) {
    console.error("Error fetching shipment tracking data:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipment tracking data" },
      { status: 500 }
    );
  }
}, { role: "manager" });
