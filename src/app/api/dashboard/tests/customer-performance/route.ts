// GET /api/dashboard/tests/customer-performance — customer progress, from the ledger.
//
// Q7 (§5.8) grouped by customer, plus Q4 (§5.5) grouped by customer for the
// numbers that belong to the requested WINDOW. Stage 5 of
// docs/dashboard-migration-plan-v2.md.
//
// WHY BOTH QUERIES
// ----------------
// Q7 answers "where does this customer's work stand right now": routed runs,
// finished runs, the five live status counts, completion and coverage. It is a
// state query and has no window — a customer's standing is not a function of
// which fortnight you happen to be looking at.
//
// But this endpoint REQUIRES startDate/endDate (it answers 400 without them)
// and the screen has a date picker. Answering a windowed request with numbers
// that ignore the window is exactly the silent-filter class §5.0 exists to
// kill. So the window is honoured by Q4, grouped by customer: how many steps
// that customer's items actually went through inside the window, and how long
// they took — on BOTH clocks (§2.8), for waiting and for active work.
//
// WHAT CHANGES, AND WHY (§9.4)
//  - `itemsInRoutesPercentage` was locked at 100: the old LEFT JOIN had decayed
//    into an INNER, so every counted item was by construction a routed item.
//    It is now coverage_pct, a real ratio.
//  - `successPercentage` is finished_runs / routed_runs — completion, not
//    success. Real success (pass/fail) is Q8's fail_pct; the name is kept only
//    because the table's column is not being rewritten until stage 6.
//  - `averageTimeMinutes` is the route turnaround on the WALL clock, and its
//    work twin now sits beside it. The old average silently returned 0 for a
//    run still open; both clocks here carry the same
//    `FILTER (WHERE closed_at IS NOT NULL)`.
//  - a customer with nothing routed in the window used to vanish from the table
//    entirely. Q7 keeps every customer and reports zeros.
//
// `totalItems` is count(DISTINCT rr.unit_id) (§5.10). unit_id is a legal
// de-duplication key here because the grouping key — the customer — is constant
// inside a unit (§5.0(6)); it would NOT be legal grouped by item type.

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { prisma } from "@/app/lib/prisma";
import type { CustomerPerformanceRow } from "@/types/dashboard";
import { filtersFromSearchParams } from "@/app/lib/metrics/filters";
import { entityProgress, entityProgressIgnored, flow } from "@/app/lib/metrics/queries";
import {
  BadRequest,
  metricsJson,
  qualify,
  requirePeriod,
} from "@/app/lib/metrics/dashboard-request";

export const runtime = "nodejs";

// successPercentage is widened to `| null`: Q7 returns NULL for a customer with
// nothing routed, and "0%" is a claim about work that was never asked for.
// tests/kpis widened its two averages for the same reason (§5.0).
interface CustomerRow
  extends Omit<CustomerPerformanceRow, "successPercentage" | "itemsInRoutesPercentage"> {
  successPercentage: number | null;
  // Widened to `| null` for the same reason successPercentage was: Q7 answers
  // NULL when the denominator is 0 — an entity that declared no items — and
  // `?? 0` turned "nothing to cover" into the claim "0% covered". Live on this
  // database: 2 of 6 customers and 3 of 11 item types have no items at all.
  itemsInRoutesPercentage: number | null;
  _new_declaredAmount: number | null;
  _new_finishedRuns: number;
  /** §2.8 — the work twin of averageTimeMinutes. */
  _new_averageTimeWorkMinutes: number | null;
  /** Q4, inside the requested window. */
  _new_windowStepsProcessed: number;
  _new_windowAvgProcessingWallMinutes: number | null;
  _new_windowAvgProcessingWorkMinutes: number | null;
  _new_windowAvgWaitWallMinutes: number | null;
  _new_windowAvgWaitWorkMinutes: number | null;
}

export const GET = withAuth(async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);

    // Contract preserved: the two dates stay required, with the same 400 body
    // the clients have always seen. Asia/Jerusalem business days, the 13-month
    // cap and the no-future-days clamp applied last and REPORTED (§6.3, §7.2)
    // rather than applied in silence.
    const period = requirePeriod(searchParams);
    const filters = filtersFromSearchParams(searchParams);
    // Qualified: the Q7 half of this response cannot honour these, the Q4 half
    // can. A bare "stationId" would leave a reader guessing which.
    const ignored = qualify("entityProgress", entityProgressIgnored(filters));

    const [progress, work, wait] = await Promise.all([
      entityProgress(prisma, "customer", filters),
      flow(prisma, period.from, period.to, filters, { dimension: "customer", byDay: false }),
      flow(prisma, period.from, period.to, filters, {
        dimension: "customer",
        family: "waiting",
        byDay: false,
      }),
    ]);

    const workById = new Map(work.map((r) => [r.customer_id ?? null, r]));
    const waitById = new Map(wait.map((r) => [r.customer_id ?? null, r]));

    // customerId identifies the entity of this screen, so it selects rows.
    const wanted = filters.customerId ?? null;

    const customers: CustomerRow[] = progress
      .filter((r) => wanted === null || r.entity_id === wanted)
      .map((r) => {
        const w = workById.get(r.entity_id) ?? null;
        const q = waitById.get(r.entity_id) ?? null;
        return {
          customerId: r.entity_id,
          customerCode: r.entity_code ?? "",
          customerName: r.entity_name ?? "",
          totalItems: r.routed_units,
          itemsInQueue: r.in_queue,
          itemsInTest: r.in_test,
          itemsWaitingForResearch: r.waiting_research,
          itemsInResearch: r.in_research,
          finishedItems: r.finished,
          itemsInRoutes: r.routed_runs,
          successPercentage: r.completion_pct,
          itemsInRoutesPercentage: r.coverage_pct,
          averageTimeMinutes: r.avg_route_turnaround_wall_min,
          _new_declaredAmount: r.declared_amount,
          _new_finishedRuns: r.finished_runs,
          _new_averageTimeWorkMinutes: r.avg_route_turnaround_work_min,
          _new_windowStepsProcessed: w ? w.steps_processed : 0,
          _new_windowAvgProcessingWallMinutes: w ? w.avg_wall_min : null,
          _new_windowAvgProcessingWorkMinutes: w ? w.avg_work_min : null,
          _new_windowAvgWaitWallMinutes: q ? q.avg_wall_min : null,
          _new_windowAvgWaitWorkMinutes: q ? q.avg_work_min : null,
        };
      })
      // The old route ordered by finished DESC, then total DESC.
      .sort((a, b) => b.finishedItems - a.finishedItems || b.totalItems - a.totalItems);

    return metricsJson(customers, period, filters, ignored);
  } catch (error) {
    if (error instanceof BadRequest) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error fetching customer performance data:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer performance data" },
      { status: 500 }
    );
  }
}, { role: "manager" });
