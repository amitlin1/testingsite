import { randomUUID } from "crypto";
import { TransactionClient } from "@/lib/db";
import { restartRoute } from "./lifecycle";

/**
 * Send a whole box back to its opening station — docs/features/packages/PLAN.md §4,
 * "שינוי סוג": an item inside a package changed type after the box was
 * opened, so the intake that was done against the old type is void and the
 * package, with every item in it, starts over.
 *
 * Every routed row (the package first, then its items) restarts its route
 * (lifecycle.ts restartRoute), all in the caller's transaction. The caller
 * has already written the new item_type_id / route_number onto item_routes
 * for the retyped item (and validated its route shape): each row restarts on
 * its CURRENT type and route, whichever one changed — so the retyped row
 * freezes its new route's fields_version here.
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

  const now = new Date();
  const actionId = randomUUID();
  for (const r of rows) {
    await restartRoute(tx, {
      itemId: r.item_id,
      itemType: r.item_type_id,
      routeNumber: r.route_number,
      now,
      abandonReason: ctx.reason,
      event: {
        key: { actionId, item: true },
        reason: "package_reset",
        workerId: ctx.workerId ?? null,
        workerName: ctx.workerName ?? null,
        payload: { package_id: packageId.toString(), trigger: ctx.reason },
      },
    });
  }
  return { packageId, resetItemIds: rows.map((r) => r.item_id) };
}
