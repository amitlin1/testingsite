import { Prisma } from "@prisma/client";
import { prisma, type TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { ItemStatus, StationStatus, WAITING_STATUSES } from "@/lib/item-status";
import { recordTransition } from "@/app/lib/metrics/ledger/record";
import type { Actor } from "./actor";
import type { StartedRow } from "./contract";
import { movesAsGroup, releaseGroup, startGroup } from "./group";

/** A test starting or stopping at a station (POST /api/testing/start-test, release-test). */
export type StartRelease = {
  itemId: bigint;
  stationId: number;
  actor: Actor;
};

/** The station, and what testing there means: a research station tests items "in research" and
 *  hands them back "waiting for research". */
async function stationOf(tx: TransactionClient, stationId: number) {
  const s = await tx.test_stations.findUnique({
    where: { test_station_id: stationId },
    select: { is_research: true, test_station_type_id: true },
  });
  if (!s) throw new HttpError(404, "Station not found");
  const isResearch = s.is_research === true;
  return {
    typeId: s.test_station_type_id,
    isResearch,
    inTest: isResearch ? ItemStatus.InResearch : ItemStatus.InTest,
    waiting: isResearch ? ItemStatus.AwaitResearch : ItemStatus.Queued,
  };
}

/** A waiting item (a box: with its items) is in test at the station; the station is active. */
export async function startTest({ itemId, stationId, actor }: StartRelease): Promise<StartedRow> {
  const now = new Date();
  const started = await prisma.$transaction(async (tx) => {
    const station = await stationOf(tx, stationId);
    const [row] = await tx.$queryRaw<{
      item_id: bigint;
      current_status: number;
      processing_start_time: Date | null;
      test_station_id: number | null;
      current_route_step: number;
    }[]>`
      UPDATE item_routes
      SET current_status = ${station.inTest},
          processing_start_time = ${now}::timestamp,
          test_station_id = ${stationId}
      WHERE item_id = ${itemId}
        AND current_status IN (${Prisma.join(WAITING_STATUSES)})
      RETURNING item_id, current_status, processing_start_time, test_station_id, current_route_step
    `;
    if (!row) throw new HttpError(404, "Item not found or not in waiting status");

    await tx.test_stations.update({
      where: { test_station_id: stationId },
      data: { status: StationStatus.Active },
    });

    // Call site #2 (§4.5), in the SAME transaction as the item_routes UPDATE (§4.8). The station is
    // the updated row's, not the body's; occurred_at is the DB's.
    await recordTransition(tx, {
      key: { actionId: actor.actionId },
      itemId,
      toState: station.isResearch ? "in_research" : "testing",
      stepNo: row.current_route_step,
      stationId: row.test_station_id,
      stationTypeId: station.typeId,
      workerId: actor.workerId,
      workerName: actor.workerName,
      reason: "test_started",
    });

    const startedPackageItems = (await movesAsGroup(tx, itemId, station))
      ? await startGroup(tx, { packageId: itemId, stationId, stationTypeId: station.typeId, actor }, now)
      : [];
    return { row, startedPackageItems };
  });

  const { row, startedPackageItems } = started;
  return {
    item_id: row.item_id.toString(),
    current_status: row.current_status,
    processing_start_time: row.processing_start_time ? new Date(row.processing_start_time).toISOString() : null,
    test_station_id: row.test_station_id,
    current_route_step: row.current_route_step,
    startedPackageItems,
  };
}

/**
 * A test started but abandoned before a result (the window closed or cancelled) goes back to
 * waiting; the station is free again. No-op if the item already moved on (a result submitted in
 * the same moment the client sent this): the WHERE only matches the in-test / in-research row.
 */
export async function releaseTest({ itemId, stationId, actor }: StartRelease): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const station = await stationOf(tx, stationId);
    const released = await tx.$queryRaw<{ item_id: bigint; current_route_step: number }[]>`
      UPDATE item_routes
      SET current_status = ${station.waiting},
          processing_start_time = NULL,
          queue_start_time = NOW()
      WHERE item_id = ${itemId}
        AND current_status = ${station.inTest}
      RETURNING item_id, current_route_step
    `;
    if (released.length === 0) return;

    await tx.test_stations.update({
      where: { test_station_id: stationId },
      data: { status: StationStatus.Free },
    });

    // Call site #3 (§4.5), in the SAME transaction as the UPDATE (§4.8). A queued interval's
    // station_type_id is the type the item still waits for; queued_research carries NULL by
    // definition (§3.6); station_id is NULL for waiting states. The worker is on the event for the
    // audit trail: isi_apply_one leaves entered_by_worker_* NULL on a waiting interval.
    await recordTransition(tx, {
      key: { actionId: actor.actionId },
      itemId,
      toState: station.isResearch ? "queued_research" : "queued",
      stepNo: released[0].current_route_step,
      stationTypeId: station.isResearch ? null : station.typeId,
      workerId: actor.workerId,
      workerName: actor.workerName,
      reason: "released_by_user",
    });

    if (await movesAsGroup(tx, itemId, station)) {
      await releaseGroup(tx, { packageId: itemId, stationId, stationTypeId: station.typeId, actor });
    }
  });
}
