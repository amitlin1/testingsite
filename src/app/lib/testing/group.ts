import type { TransactionClient } from "@/lib/db";
import { ItemStatus, StationStatus } from "@/lib/item-status";
import { recordTransition } from "@/app/lib/metrics/ledger/record";
import { isPackageLevelStationType, loadPackageContext } from "@/app/lib/packages/context";
import type { Actor } from "./actor";

/**
 * A box's group (docs/features/packages/PLAN.md §4). At a package-level station (opening, closing) the box and
 * the items inside it are tested together, and package-level queues never list those items — so
 * whatever starts or stops the box's test starts or stops theirs, each item with its own ledger
 * event (a real testing interval per item, no synthetic pair).
 */

type Group = {
  packageId: bigint;
  stationId: number;
  stationTypeId: number;
  actor: Actor;
};

/** The item is a box at a package-level station that is not a research one: it moves with its items. */
export async function movesAsGroup(
  tx: TransactionClient, itemId: bigint, station: { isResearch: boolean; typeId: number },
): Promise<boolean> {
  const pkgCtx = await loadPackageContext(tx, itemId);
  return pkgCtx?.isPackage === true && !station.isResearch && (await isPackageLevelStationType(tx, station.typeId));
}

/** Start-test: every item of the box waiting for this station's type is in test there too.
 *  The ids of the items it started. */
export async function startGroup(tx: TransactionClient, g: Group, now: Date): Promise<string[]> {
  const members = await tx.$queryRaw<{ item_id: bigint; current_route_step: number }[]>`
    UPDATE item_routes ir
       SET current_status = ${ItemStatus.InTest},
           processing_start_time = ${now}::timestamp,
           test_station_id = ${g.stationId}
      FROM items i, testing_routes tr
     WHERE i.item_id = ir.item_id
       AND i.package_id = ${g.packageId}
       AND tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
       AND ir.current_status = ${ItemStatus.Queued}
       AND ir.finished_at IS NULL
       AND tr.route_steps[ir.current_route_step] = ${g.stationTypeId}
    RETURNING ir.item_id, ir.current_route_step
  `;
  for (const m of members) {
    await recordTransition(tx, {
      key: { actionId: g.actor.actionId, item: true },
      itemId: m.item_id,
      toState: "testing",
      stepNo: m.current_route_step,
      stationId: g.stationId,
      stationTypeId: g.stationTypeId,
      workerId: g.actor.workerId,
      workerName: g.actor.workerName,
      reason: "test_started",
      payload: { package_id: String(g.packageId), group_start: true },
    });
  }
  return members.map((m) => m.item_id.toString());
}

/** Release-test: the items of the box in test at this station go back to waiting. */
export async function releaseGroup(tx: TransactionClient, g: Group): Promise<void> {
  const members = await tx.$queryRaw<{ item_id: bigint; current_route_step: number }[]>`
    UPDATE item_routes ir
       SET current_status = ${ItemStatus.Queued},
           processing_start_time = NULL,
           queue_start_time = NOW()
      FROM items i
     WHERE i.item_id = ir.item_id
       AND i.package_id = ${g.packageId}
       AND ir.current_status = ${ItemStatus.InTest}
       AND ir.test_station_id = ${g.stationId}
       AND ir.finished_at IS NULL
    RETURNING ir.item_id, ir.current_route_step
  `;
  for (const m of members) {
    await recordTransition(tx, {
      key: { actionId: g.actor.actionId, item: true },
      itemId: m.item_id,
      toState: "queued",
      stepNo: m.current_route_step,
      stationTypeId: g.stationTypeId,
      workerId: g.actor.workerId,
      workerName: g.actor.workerName,
      reason: "released_by_user",
      payload: { package_id: String(g.packageId), group_release: true },
    });
  }
}

/** A box whose closing is open at a station: in test at a package-level step. */
export type OpenClosing = { packageId: bigint; stationId: number; stepNo: number; stepTypeId: number };

/**
 * Step-back: the box's closing, open at the item's station and step type — or null. The box row is
 * locked: the item's row is, and releaseClosing writes both.
 */
export async function openClosingOf(
  tx: TransactionClient, packageId: bigint, itemStationId: number | null, itemStepTypeId: number | null,
): Promise<OpenClosing | null> {
  if (itemStationId == null || itemStepTypeId == null) return null;
  const rows = await tx.$queryRaw<{
    current_status: number; current_route_step: number; test_station_id: number | null;
    route_steps: number[] | null; is_finished: boolean;
  }[]>`
    SELECT ir.current_status, ir.current_route_step, ir.test_station_id, tr.route_steps, ir.is_finished
      FROM item_routes ir
      LEFT JOIN testing_routes tr
        ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
     WHERE ir.item_id = ${packageId}
     FOR UPDATE OF ir
  `;
  const box = rows[0];
  if (!box || box.is_finished || box.current_status !== ItemStatus.InTest || box.test_station_id !== itemStationId) return null;
  const boxTypeId = box.route_steps?.[box.current_route_step - 1];
  if (boxTypeId == null || Number(boxTypeId) !== itemStepTypeId || box.current_route_step <= 1) return null;
  if (!(await isPackageLevelStationType(tx, Number(boxTypeId)))) return null;
  return { packageId, stationId: itemStationId, stepNo: box.current_route_step, stepTypeId: Number(boxTypeId) };
}

/** Step-back, for the box whose closing stops: the box and every item in test with it at that
 *  station back to waiting, an event each — the box's included, unlike releaseGroup's. */
export async function releaseClosing(tx: TransactionClient, c: OpenClosing, now: Date, actor: Actor): Promise<void> {
  const released = await tx.$queryRaw<{ item_id: bigint; current_route_step: number; is_box: boolean }[]>`
    UPDATE item_routes ir
       SET current_status = ${ItemStatus.Queued}, processing_start_time = NULL, queue_start_time = ${now}::timestamp
     WHERE ir.current_status = ${ItemStatus.InTest} AND ir.test_station_id = ${c.stationId} AND ir.finished_at IS NULL
       AND (ir.item_id = ${c.packageId}
            OR ir.item_id IN (SELECT i.item_id FROM items i WHERE i.package_id = ${c.packageId}))
    RETURNING ir.item_id, ir.current_route_step, (ir.item_id = ${c.packageId}) AS is_box
  `;
  if (released.length === 0) return;
  await tx.test_stations.update({ where: { test_station_id: c.stationId }, data: { status: StationStatus.Free } });
  for (const r of released) {
    await recordTransition(tx, {
      key: { actionId: actor.actionId, item: true },
      itemId: r.item_id,
      toState: "queued",
      stepNo: r.current_route_step,
      stationTypeId: c.stepTypeId,
      workerId: actor.workerId,
      workerName: actor.workerName,
      reason: "released_by_user",
      submitId: actor.actionId,
      payload: { package_id: String(c.packageId), group_release: !r.is_box, site: "step_back_closing" },
    });
  }
}
