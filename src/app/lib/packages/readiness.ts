import { randomUUID } from "crypto";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordTransition } from "@/app/lib/metrics/record";
import { TransactionClient } from "@/app/lib/prisma";

/**
 * The meeting point at the closing station — docs/packages/PLAN.md §4.
 *
 * A package sitting at a package-level step other than its first is either
 * "waiting" (status 2: every unfinished item inside it is at that step) or
 * "waiting for package items" (status 6: at least one item is still
 * elsewhere). recheckPackageReadiness computes which and flips the row when
 * it disagrees, recording the transition in the ledger in the same tx.
 *
 * Call it whenever a fact it depends on changed: the package advanced onto a
 * package-level step, an item inside it advanced / finished / was deleted.
 * Idempotent — a call that changes nothing writes nothing.
 */

export const STATUS_QUEUED = 2;
export const STATUS_WAITING_FOR_PACKAGE_ITEMS = 6;

type Reader = Pick<TransactionClient, "$queryRaw" | "test_stations_type">;

export type PackageGate = {
  packageId: bigint;
  /** The package's current status, or null when it has no live route row. */
  status: number | null;
  /** True when the package sits at a package-level step after its first. */
  atGate: boolean;
  stepNo: number | null;
  stepTypeId: number | null;
  /** Unfinished items inside the box that are not at this step. */
  blockingItemIds: bigint[];
};

type PackageRow = {
  item_id: bigint;
  item_type_id: number;
  route_number: number;
  current_status: number;
  current_route_step: number;
  is_finished: boolean;
  route_steps: number[] | null;
};

type MemberRow = {
  item_id: bigint;
  current_status: number | null;
  is_finished: boolean | null;
  step_type_id: number | null;
};

async function loadPackageRow(db: Reader, packageId: bigint, lock: boolean): Promise<PackageRow | null> {
  const rows = lock
    ? await db.$queryRaw<PackageRow[]>`
        SELECT ir.item_id, ir.item_type_id, ir.route_number, ir.current_status, ir.current_route_step,
               ir.is_finished, tr.route_steps
        FROM item_routes ir
        LEFT JOIN testing_routes tr
               ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
        WHERE ir.item_id = ${packageId}
        FOR UPDATE OF ir`
    : await db.$queryRaw<PackageRow[]>`
        SELECT ir.item_id, ir.item_type_id, ir.route_number, ir.current_status, ir.current_route_step,
               ir.is_finished, tr.route_steps
        FROM item_routes ir
        LEFT JOIN testing_routes tr
               ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
        WHERE ir.item_id = ${packageId}`;
  return rows[0] ?? null;
}

/** Read-only: where the package stands against its gate. */
export async function computePackageGate(db: Reader, packageId: bigint, lock = false): Promise<PackageGate> {
  const none: PackageGate = { packageId, status: null, atGate: false, stepNo: null, stepTypeId: null, blockingItemIds: [] };
  const pkg = await loadPackageRow(db, packageId, lock);
  if (!pkg) return none;
  const base = { ...none, status: pkg.current_status };
  if (pkg.is_finished) return base;

  const steps = pkg.route_steps ?? [];
  const step = pkg.current_route_step;
  // The gate exists only at a package-level step AFTER the first: the opening
  // step needs no readiness (every item is created there).
  if (step <= 1 || step > steps.length) return base;
  const stepTypeId = steps[step - 1];
  const stepType = await db.test_stations_type.findUnique({
    where: { test_station_type_id: stepTypeId },
    select: { package_level: true },
  });
  if (!stepType?.package_level) return base;

  // An item is "present" when it finished its route (it will not come — the
  // closing wizard reports it as not arrived) or when its current step is
  // this same station type and it is waiting or in test there. Anything
  // else — mid-route, in research, waiting for research — blocks.
  const members = await db.$queryRaw<MemberRow[]>`
    SELECT i.item_id, ir.current_status, ir.is_finished,
           tr.route_steps[ir.current_route_step] AS step_type_id
    FROM items i
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN testing_routes tr
           ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
    WHERE i.package_id = ${packageId}
  `;
  const blocking = members
    .filter((m) => {
      if (m.is_finished) return false;
      if (m.current_status == null) return false; // orphan items row: nothing to wait for
      const here = m.step_type_id === stepTypeId && (m.current_status === 1 || m.current_status === 2);
      return !here;
    })
    .map((m) => m.item_id);

  return { packageId, status: pkg.current_status, atGate: true, stepNo: step, stepTypeId, blockingItemIds: blocking };
}

export type ReadinessContext = {
  /** The human action this recheck belongs to (stamped on the event). */
  submitId?: string | null;
  workerId?: number | null;
  workerName?: string | null;
};

export type ReadinessOutcome = PackageGate & { changed: boolean };

export async function recheckPackageReadiness(
  tx: TransactionClient,
  packageId: bigint,
  ctx: ReadinessContext = {},
): Promise<ReadinessOutcome> {
  // Lock the package's route row: two items of the same box finishing at
  // once must serialise here, or both could see "one still missing".
  const gate = await computePackageGate(tx, packageId, true);
  if (!gate.atGate || gate.stepNo == null) return { ...gate, changed: false };
  if (gate.status !== STATUS_QUEUED && gate.status !== STATUS_WAITING_FOR_PACKAGE_ITEMS) {
    return { ...gate, changed: false };
  }

  const ready = gate.blockingItemIds.length === 0;
  const now = new Date(getCurrentUtcIso());
  // The status guard on each UPDATE is what makes a repeated call a no-op;
  // the event is recorded only when a row actually flipped, so the key can
  // be fresh every time (one submit may legitimately move a box twice).
  const eventKey = (prefix: string) => `${prefix}:${packageId}:${randomUUID()}`;

  if (ready && gate.status === STATUS_WAITING_FOR_PACKAGE_ITEMS) {
    // The last item arrived: the box starts waiting for the closing station
    // NOW, so its queue time is honest (PLAN.md §4, decision 12).
    const pkgRow = await loadPackageRow(tx, packageId, false);
    const stationId = pkgRow
      ? await findStationForRouteStep(tx, pkgRow.item_type_id, pkgRow.route_number, gate.stepNo)
      : null;
    const flipped = await tx.$executeRaw`
      UPDATE item_routes
         SET current_status = ${STATUS_QUEUED}, queue_start_time = ${now}::timestamp, test_station_id = ${stationId}
       WHERE item_id = ${packageId} AND current_status = ${STATUS_WAITING_FOR_PACKAGE_ITEMS}
    `;
    if (flipped > 0) {
      await recordTransition(tx, {
        eventKey: eventKey("package_items_ready"),
        itemId: packageId,
        toState: "queued",
        stepNo: gate.stepNo,
        stationId: null,
        stationTypeId: gate.stepTypeId,
        workerId: ctx.workerId ?? null,
        workerName: ctx.workerName ?? null,
        reason: "package_items_ready",
        submitId: ctx.submitId ?? null,
        payload: { package_id: packageId.toString() },
      });
    }
    return { ...gate, status: STATUS_QUEUED, changed: flipped > 0 };
  }

  if (!ready && gate.status === STATUS_QUEUED) {
    const flipped = await tx.$executeRaw`
      UPDATE item_routes
         SET current_status = ${STATUS_WAITING_FOR_PACKAGE_ITEMS}, queue_start_time = ${now}::timestamp
       WHERE item_id = ${packageId} AND current_status = ${STATUS_QUEUED}
    `;
    if (flipped > 0) {
      await recordTransition(tx, {
        eventKey: eventKey("package_items_pending"),
        itemId: packageId,
        toState: "waiting_for_package_items",
        stepNo: gate.stepNo,
        stationId: null,
        stationTypeId: gate.stepTypeId,
        workerId: ctx.workerId ?? null,
        workerName: ctx.workerName ?? null,
        reason: "package_items_pending",
        submitId: ctx.submitId ?? null,
        payload: {
          package_id: packageId.toString(),
          blocking_item_ids: gate.blockingItemIds.map((b) => b.toString()),
        },
      });
    }
    return { ...gate, status: STATUS_WAITING_FOR_PACKAGE_ITEMS, changed: flipped > 0 };
  }

  return { ...gate, changed: false };
}
