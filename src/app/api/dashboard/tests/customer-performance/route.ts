// Customer performance: Q7 (§5.8) by customer for where the work stands now,
// plus Q4 (§5.5) by customer for what happened inside the requested WINDOW.
//
// Q7 is a state query with no window. The endpoint still takes a window (and
// answers 400 without one), so the window is honoured by Q4 — the steps the
// customer's items went through in it and how long they took, on both clocks —
// rather than answered with numbers that ignore it.
//
// `successPercentage` is COMPLETION (finished_runs / routed_runs) under its
// legacy name; pass/fail success is not on this screen. `totalItems` is
// count(DISTINCT unit_id): a legal de-duplication key here because a unit never
// changes customer (§5.0(6)). Every customer is returned, zeros included.

import { prisma } from "@/lib/db";
import type { CustomerWire } from "@/app/lib/dashboard/contract";
import { qualify, selectEntity, unhonoured } from "@/app/lib/metrics/read/filters";
import { entityProgress, flow } from "@/app/lib/metrics/read/queries";
import { metricsRoute } from "../../_lib/metrics-route";

export const GET = metricsRoute("window", "Failed to fetch customer performance data", async ({ period, filters }) => {
  const [progress, work, wait] = await Promise.all([
    entityProgress(prisma, "customer", filters),
    flow(prisma, period.from, period.to, filters, { dimension: "customer", byDay: false }),
    flow(prisma, period.from, period.to, filters, { dimension: "customer", family: "waiting", byDay: false }),
  ]);

  const workById = new Map(work.map((r) => [r.customer_id ?? null, r]));
  const waitById = new Map(wait.map((r) => [r.customer_id ?? null, r]));

  const customers = selectEntity(progress, filters.customerId)
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
      } satisfies CustomerWire;
    })
    .sort((a, b) => b.finishedItems - a.finishedItems || b.totalItems - a.totalItems);

  // Qualified: the Q7 half cannot honour these, the Q4 half can.
  return { body: customers, filters, ignored: qualify("entityProgress", unhonoured("entityProgress", filters)) };
});
