import { randomUUID } from "crypto";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordTransition } from "@/app/lib/metrics/record";
import { abandonRun } from "@/app/lib/metrics/item-lifecycle";
import { TransactionClient } from "@/app/lib/prisma";

/**
 * Send a whole box back to its opening station — docs/packages/PLAN.md §4,
 * "שינוי סוג": an item inside a package changed type after the box was
 * opened, so the intake that was done against the old type is void and the
 * package, with every item in it, starts over.
 *
 * For each routed row (the package first, then its items): the open ledger
 * run is abandoned (closed with is_trusted = false, so it never counts as a
 * completion), item_routes goes back to step 1 / queued / the opening
 * station, and a fresh `queued` transition opens the next run. All in the
 * caller's transaction.
 *
 * The caller has already written the new item_type_id / route_number onto
 * item_routes for the retyped item (and validated its route shape), so this
 * function reads each row's CURRENT type and route and does not care which
 * one changed.
 */
export type PackageResetOutcome = {
  packageId: bigint;
  resetItemIds: bigint[];
};

export async function resetPackageToOpening(
  tx: TransactionClient,
  packageId: bigint,
  ctx: { reason: string; workerId?: number | null; workerName?: string | null },
): Promise<PackageResetOutcome> {
  const rows = await tx.$queryRaw<{ item_id: bigint; item_type_id: number; route_number: number }[]>`
    SELECT ir.item_id, ir.item_type_id, ir.route_number
    FROM item_routes ir
    JOIN items i ON i.item_id = ir.item_id
    WHERE i.item_id = ${packageId} OR i.package_id = ${packageId}
    ORDER BY (i.package_id IS NULL) DESC, i.package_seq
    FOR UPDATE OF ir
  `;
  if (rows.length === 0) return { packageId, resetItemIds: [] };

  const now = new Date(getCurrentUtcIso());
  const actionId = randomUUID();
  const resetItemIds: bigint[] = [];

  for (const r of rows) {
    const stationId = await findStationForRouteStep(tx, r.item_type_id, r.route_number, 1);
    await tx.$executeRaw`
      UPDATE item_routes
         SET current_route_step = 1,
             current_status = 2,
             test_station_id = ${stationId},
             is_finished = false,
             finished_at = NULL,
             queue_start_time = ${now}::timestamp,
             processing_start_time = NULL
       WHERE item_id = ${r.item_id}
    `;

    // Close the old run first: metrics_record reuses an OPEN run, and
    // route_run_one_open forbids a second one.
    await abandonRun(tx, r.item_id, ctx.reason);

    const route = await tx.testing_routes.findFirst({
      where: { item_type_id: r.item_type_id, route_number: r.route_number },
      select: { route_steps: true },
    });
    await recordTransition(tx, {
      eventKey: `package_reset:${actionId}:${r.item_id}`,
      itemId: r.item_id,
      toState: "queued",
      stepNo: 1,
      stationId: null,
      stationTypeId: route?.route_steps?.[0] ?? null,
      workerId: ctx.workerId ?? null,
      workerName: ctx.workerName ?? null,
      reason: "package_reset",
      payload: { package_id: packageId.toString(), trigger: ctx.reason },
    });
    resetItemIds.push(r.item_id);
  }

  return { packageId, resetItemIds };
}
