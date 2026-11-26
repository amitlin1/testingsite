import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { ItemStatus, isInTestStatus } from "@/lib/item-status";
import { resolveLegacyId } from "@/app/lib/legacy-id-map";
import { idOfLabel } from "@/app/lib/packages/ids";
import { computePackageGate } from "@/app/lib/packages/readiness";
import type { LocateAnswer } from "./contract";

/**
 * GET /api/testing/locate-by-barcode: an item label ("itemId" or "itemId-sourceId") → the test
 * station the item is at or waits for, so the testing page can select that station and hoist the
 * item to the top of its list.
 *
 * By status:
 *   in test / in research   the station it is at
 *   queued                  the first station (by name) of its step's type
 *   waiting for research    the first research station (by name)
 *   done                    a "finished" answer (200)
 *   waiting for its items   a box held before its closing: which items are still out
 *
 * Labels printed before the package-model upgrade carry the item's OLD id: when the scanned id has
 * no route but maps to a converted item (legacy_id_map), the lookup is answered for the new id and
 * the answer adds `legacyId` / `resolvedItemId`, so the screen can tell the worker the box still
 * wears its old label.
 */
export async function locateBarcode(barcode: string): Promise<LocateAnswer> {
  const itemId = idOfLabel(barcode);
  if (itemId == null) throw new HttpError(400, "ברקוד לא תקין");

  const found = await locateItem(itemId);
  if ("answer" in found) return found.answer;
  if (found.notFound) {
    const resolved = await resolveLegacyId(itemId);
    if (resolved != null && resolved !== itemId) {
      const legacy = { legacyId: Number(itemId), resolvedItemId: Number(resolved) };
      const again = await locateItem(resolved);
      if ("answer" in again) return { ...again.answer, ...legacy };
      throw new HttpError(again.refusal.status, again.refusal.message, { extra: { ...again.refusal.extra, ...legacy } });
    }
  }
  throw found.refusal;
}

/** Where the item is, or the 404 that says why not — `notFound` when it has no route at all. */
type Located = { answer: LocateAnswer } | { refusal: HttpError; notFound: boolean };

async function locateItem(itemId: bigint): Promise<Located> {
  const [row] = await prisma.$queryRaw<{
    itemId: bigint;
    currentStatus: number;
    currentRouteStep: number;
    testStationId: number | null;
    isFinished: boolean;
    routeSteps: number[] | null;
    serialNo: string | null;
    makat: string;
    model: string;
  }[]>`
    SELECT
        ir.item_id              AS "itemId",
        ir.current_status       AS "currentStatus",
        ir.current_route_step   AS "currentRouteStep",
        ir.test_station_id      AS "testStationId",
        ir.is_finished          AS "isFinished",
        tr.route_steps          AS "routeSteps",
        i.serial_no             AS "serialNo",
        i.makat                 AS "makat",
        i.model                 AS "model"
    FROM item_routes ir
    INNER JOIN items i
        ON i.item_id = ir.item_id
    LEFT JOIN testing_routes tr
        ON tr.item_type_id = ir.item_type_id
       AND tr.route_number = ir.route_number
    WHERE ir.item_id = ${itemId}
  `;

  if (!row) {
    // A box whose label printed with its shipment but that was not taken in yet has no route
    // (lib/packages/boxes.ts) — say so, not "not found".
    const pending = await prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM items i JOIN item_types t ON t.item_type_id = i.item_type_id
      WHERE i.item_id = ${itemId} AND i.package_id IS NULL AND t.is_package
    `;
    const refusal = pending.length > 0
      ? new HttpError(404, "המארז עוד לא נקלט — יש לסרוק אותו בקליטת מארזים", { extra: { pendingIntake: true } })
      : new HttpError(404, "פריט לא נמצא");
    return { refusal, notFound: true };
  }

  const currentStatus = Number(row.currentStatus);
  const currentRouteStep = Number(row.currentRouteStep);
  const routeSteps = row.routeSteps ?? [];
  const what = { itemId: Number(row.itemId), serialNo: row.serialNo, makat: row.makat ?? null, model: row.model };

  if (row.isFinished || currentStatus === ItemStatus.Done) {
    // Not an error: a "finished" answer, so the client shows a friendly dialog, not a red toast.
    return { answer: { finished: true, ...what } };
  }

  if (currentStatus === ItemStatus.AwaitPackageItems) {
    // A box waiting for its items before the closing station (docs/features/packages/PLAN.md §4): which
    // items are still out, so the client says so instead of "no station".
    const gate = await computePackageGate(prisma, itemId);
    return {
      answer: {
        waitingForPackageItems: true,
        itemId: what.itemId,
        currentStatus,
        serialNo: what.serialNo,
        makat: what.makat,
        model: what.model,
        stationTypeId: gate.stepTypeId,
        blockingItemIds: gate.blockingItemIds.map((b) => Number(b)),
      },
    };
  }

  let stationId: number | null = null;
  let stationTypeId: number | null = null;

  if (isInTestStatus(currentStatus) && row.testStationId != null) {
    stationId = Number(row.testStationId);
    const station = await prisma.test_stations.findUnique({
      where: { test_station_id: stationId },
      select: { test_station_type_id: true },
    });
    stationTypeId = station?.test_station_type_id ?? null;
  } else if (currentStatus === ItemStatus.Queued) {
    if (currentRouteStep >= 1 && currentRouteStep <= routeSteps.length) {
      stationTypeId = Number(routeSteps[currentRouteStep - 1]);
    }
    if (stationTypeId != null) {
      const station = await prisma.test_stations.findFirst({
        where: { test_station_type_id: stationTypeId, is_research: false },
        orderBy: { test_station_desc: "asc" },
        select: { test_station_id: true },
      });
      stationId = station?.test_station_id ?? null;
    }
  } else if (currentStatus === ItemStatus.AwaitResearch) {
    const station = await prisma.test_stations.findFirst({
      where: { is_research: true },
      orderBy: { test_station_desc: "asc" },
      select: { test_station_id: true, test_station_type_id: true },
    });
    stationId = station?.test_station_id ?? null;
    stationTypeId = station?.test_station_type_id ?? null;
  }

  if (stationId == null || stationTypeId == null) {
    return { refusal: new HttpError(404, "לא נמצאה עמדה זמינה לפריט זה"), notFound: false };
  }
  return {
    answer: {
      itemId: what.itemId,
      currentStatus,
      serialNo: what.serialNo,
      makat: what.makat,
      model: what.model,
      stationId,
      stationTypeId,
    },
  };
}
