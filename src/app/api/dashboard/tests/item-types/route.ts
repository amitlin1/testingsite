// Item-type progress: Q7 (§5.8) by item type — a state query, no window.
//
// Counted in ROUTE RUNS, never DISTINCT unit_id: an accessory shares its
// parent's unit_id but carries its own type, so unit_id undercounts by ~4x
// (§5.0(6)) — which is why routed units are not on this endpoint at all.
// `totalItems` is the routed population (§5.10), not SUM(shipments.amount); the
// declared amount ships beside it under its own name. Every type is returned,
// zeros included.

import { prisma } from "@/lib/db";
import type { ItemTypeWire } from "@/app/lib/dashboard/contract";
import { qualify, selectEntity, unhonoured } from "@/app/lib/metrics/read/filters";
import { entityProgress } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("none", "Failed to fetch item type tracking data", async ({ filters }) => {
  const rows = await entityProgress(prisma, "item_type", filters);

  // The per-run filters stay inside Q7's LEFT JOIN.
  const itemTypes = selectEntity(rows, filters.itemTypeId)
    .map(
      (r) =>
        ({
          itemTypeId: r.entity_id,
          itemTypeDesc: r.entity_name ?? "",
          totalItems: r.routed_runs,
          itemsInQueue: r.in_queue,
          itemsInTest: r.in_test,
          itemsWaitingForResearch: r.waiting_research,
          itemsInResearch: r.in_research,
          itemsFinished: r.finished,
          itemsInRoutes: r.routed_runs,
          completionPercentage: r.completion_pct,
          itemsInRoutesPercentage: r.coverage_pct,
          _new_declaredAmount: r.declared_amount,
          _new_finishedRuns: r.finished_runs,
          _new_routeTurnaroundWallMinutes: r.avg_route_turnaround_wall_min,
          _new_routeTurnaroundWorkMinutes: r.avg_route_turnaround_work_min,
        }) satisfies ItemTypeWire,
    )
    .sort((a, b) => a.itemTypeDesc.localeCompare(b.itemTypeDesc, "he"));

  return { body: itemTypes, filters, ignored: qualify("entityProgress", unhonoured("entityProgress", filters)) };
});
