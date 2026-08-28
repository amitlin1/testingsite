// GET /api/dashboard/tests/item-types — item-type progress, from the ledger.
//
// Q7 (§5.8) grouped by item_type_id. Stage 5 of docs/dashboard-migration-plan-v2.md.
//
// TWO THINGS THE OLD QUERY GOT WRONG, BOTH FIXED HERE (§5.8, §9.4)
// ----------------------------------------------------------------
//  1. `total_items` was `SUM(shipments.amount)` over shipment_items. amount is
//     an INVENTORY number: it counts what the customer declared, is summed once
//     per shipment LINE (so it inflates by the number of lines), and is 0
//     wherever it was never filled in. It is never a denominator for tested
//     work. `item_type_total_items` is redefined by §5.10 as
//     count(DISTINCT route_run_id) — the routed population — and the declared
//     amount survives as a separate, separately-named number
//     (`_new_declaredAmount`), with coverage reported against it.
//  2. Grouping by item type counts ROUTE RUNS, never DISTINCT unit_id.
//     An accessory shares its parent's unit_id but carries its own
//     item_type_id, so unit_id here undercounts by roughly 4x (§5.0(6):
//     unit_id is a legal de-duplication key only where the grouping key is
//     constant inside a unit — customer and shipment, not item type).
//
// The old route also dropped every item type with no routed run
// (`HAVING COUNT(DISTINCT ir.item_id) > 0`, a LEFT JOIN decayed into an INNER).
// Q7 keeps every type and reports zeros — §9.4.
//
// Contract: unchanged. No date params (this screen never sent any), same query
// string, same ItemTypeTrackingRow field set. The two-clock pair of §2.8 arrives
// as `_new_routeTurnaround{Wall,Work}Minutes`; the components move in stage 6.

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import type { ItemTypeTrackingRow } from "@/types/dashboard";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { entityProgress, entityProgressIgnored } from "@/app/lib/metrics/queries";
import { qualify } from "@/app/lib/metrics/dashboard-request";

export const runtime = "nodejs";

/** The row the table reads today, plus the §2.8 / §5.10 additions.
 *  completionPercentage is widened to `| null`: Q7 returns NULL for a type with
 *  nothing routed, and "0% complete" is a claim about work that was never asked
 *  for. Same reasoning as the two widened averages in tests/kpis (§5.0). */
interface ItemTypeRow
  extends Omit<ItemTypeTrackingRow, "completionPercentage" | "itemsInRoutesPercentage"> {
  completionPercentage: number | null;
  // Widened to `| null` for the same reason successPercentage was: Q7 answers
  // NULL when the denominator is 0 — an entity that declared no items — and
  // `?? 0` turned "nothing to cover" into the claim "0% covered". Live on this
  // database: 2 of 6 customers and 3 of 11 item types have no items at all.
  itemsInRoutesPercentage: number | null;
  /** shipments.amount, kept as a separate number with a separate name. */
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  /** §2.8 — the pair. Neither one substitutes for the other. */
  _new_routeTurnaroundWallMinutes: number | null;
  _new_routeTurnaroundWorkMinutes: number | null;
}

// `routed_units` is deliberately NOT exposed here. Grouped by item type it is
// the wrong number by construction — an accessory shares its parent's unit_id
// but carries its own type — and §5.8 measures this screen in route runs. The
// filters Q7 cannot express travel in the X-Metrics-Ignored-Filters header.

export const GET = withAuth(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    // §5.0(1): one parameter, `scope`. `showAllHistory=true` is still accepted
    // as its legacy spelling so a bookmarked URL keeps working; `showSent` is
    // deliberately not read.
    const filters = filtersFromSearchParams(searchParams);
    // Qualified with the query that cannot honour them, so a reader is never
    // left guessing whether the whole response or one number is unfiltered.
    const ignored = qualify("entityProgress", entityProgressIgnored(filters));

    const rows = await entityProgress(prisma, "item_type", filters);

    // `itemTypeId` identifies the ENTITY of this screen, so it selects rows
    // rather than narrowing the runs inside them: asking for one item type must
    // return one row, not every type with zeros in the others. The filters Q7
    // applies per-run (customer, shipment, serial, accessory, scope) stay where
    // they are, inside the LEFT JOIN's ON.
    const wanted = filters.itemTypeId ?? null;

    const itemTypes: ItemTypeRow[] = rows
      .filter((r) => wanted === null || r.entity_id === wanted)
      .map((r) => ({
        itemTypeId: r.entity_id,
        itemTypeDesc: r.entity_name ?? "",
        // §5.10 — redefined: the routed population, not SUM(amount).
        totalItems: r.routed_runs,
        itemsInQueue: r.in_queue,
        itemsInTest: r.in_test,
        itemsWaitingForResearch: r.waiting_research,
        itemsInResearch: r.in_research,
        itemsFinished: r.finished,
        itemsInRoutes: r.routed_runs,
        // finished_runs / routed_runs — the same formula as shipments and
        // customers, one denominator everywhere (§5.8). NULL means "nothing
        // routed" and is passed through as NULL; the honest pair (finishedRuns,
        // itemsInRoutes) sits beside it.
        completionPercentage: r.completion_pct,
        itemsInRoutesPercentage: r.coverage_pct,
        _new_declaredAmount: r.declared_amount,
        _new_finishedRuns: r.finished_runs,
        _new_routeTurnaroundWallMinutes: r.avg_route_turnaround_wall_min,
        _new_routeTurnaroundWorkMinutes: r.avg_route_turnaround_work_min,
      }))
      // The old route ordered by item_type_desc; Q7 orders by id. Restored here
      // so the screen's row order does not change under the conversion.
      .sort((a, b) => a.itemTypeDesc.localeCompare(b.itemTypeDesc, "he"));

    // No period headers: this screen has no date picker and Q7 has no window
    // (§5.8 — entity progress is a state query). The header vocabulary is
    // otherwise the one dashboard-request.ts establishes for the whole stage.
    const headers: Record<string, string> = {
      "X-Metrics-Scope": filters.scope === "all" ? "all" : "open_shipments",
    };
    // Named, never silently dropped (§5.0). Q7 is anchored on route_run and the
    // entity's own table; station / station type / worker / serial / status are
    // per-STEP facts that no longer identify an entity once the run is the unit.
    if (ignored.length > 0) headers["X-Metrics-Ignored-Filters"] = ignored.join(",");
    return NextResponse.json(itemTypes, { headers });
  } catch (error) {
    console.error("Error fetching item type tracking data:", error);
    return NextResponse.json(
      { error: "Failed to fetch item type tracking data" },
      { status: 500 }
    );
  }
}, { role: "manager" });
