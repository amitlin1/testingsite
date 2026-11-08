import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordNote, recordTransition } from "@/app/lib/metrics/record";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { isPackageLevelStationType, loadPackageContext } from "@/app/lib/packages/context";
import { recheckPackageReadiness } from "@/app/lib/packages/readiness";
import { withAuth } from "@/lib/auth/withAuth";

export const runtime = "nodejs";

/** A refusal the worker reads as it is (Hebrew), with its HTTP status. */
class StepBackError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/testing/step-back — "חזרה לבדיקה הקודמת" on a queue card.
 * Body: { itemId, currentRouteStep, workerId?, workerName?, actionId? }
 *
 * Sends a WAITING item one step back on its route: it waits again at the
 * station type of the step before, to be tested there anew. Nothing is
 * deleted — the earlier result stays in the history, and the item report
 * prints a step's latest result, so the new one replaces it there.
 *
 * Refused (409, the reason in words): an item in test or in research, a
 * finished one, one at the first step, a whole box, and a step back onto a
 * package-level step (the box opening is the whole box's, not one item's).
 * `currentRouteStep` is the step the card showed: the UPDATE matches only
 * that step and status, so two clicks never take the item back twice.
 *
 * Ledger: a "queued" transition at the earlier step, reason manual_override
 * (payload.action = "step_back") — the metrics count it as that step's next
 * attempt. An item inside a box rechecks the box's gate in the same tx.
 *
 * Managers only (role "manager"): anyone else gets 403 before anything is
 * read, and the testing screen does not show them the button.
 */
export const POST = withAuth(async (req) => {
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json().catch(() => ({}));
    const itemIdRaw = body?.itemId;
    const shownStep = Number(body?.currentRouteStep);
    if (itemIdRaw == null || !/^\d+$/.test(String(itemIdRaw)) || !Number.isInteger(shownStep) || shownStep < 1) {
      return NextResponse.json({ error: "itemId and currentRouteStep are required" }, { status: 400 });
    }
    const itemIdBig = BigInt(String(itemIdRaw));
    const workerId: number | null = typeof body.workerId === "number" ? body.workerId : null;
    const workerName: string | null = typeof body.workerName === "string" && body.workerName ? body.workerName : null;
    const actionId: string = typeof body.actionId === "string" && UUID_RE.test(body.actionId) ? body.actionId : randomUUID();

    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{
        item_type_id: number; route_number: number; current_status: number;
        current_route_step: number; is_finished: boolean; route_steps: number[] | null;
      }[]>`
        SELECT ir.item_type_id, ir.route_number, ir.current_status, ir.current_route_step,
               ir.is_finished, tr.route_steps
          FROM item_routes ir
          LEFT JOIN testing_routes tr
            ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
         WHERE ir.item_id = ${itemIdBig}
         FOR UPDATE OF ir
      `;
      const row = rows[0];
      if (!row) throw new StepBackError("הפריט לא נמצא", 404);

      const pkgCtx = await loadPackageContext(tx, itemIdBig);
      if (pkgCtx?.isPackage) throw new StepBackError("מארז שלם לא מוחזר מכאן — רק פריט בודד.", 409);
      if (row.is_finished || row.current_status === 3) throw new StepBackError("הפריט סיים את המסלול.", 409);
      if (row.current_status === 1) throw new StepBackError("הפריט בבדיקה כרגע. צריך לצאת מהבדיקה לפני שמחזירים אותו.", 409);
      if (row.current_status === 4 || row.current_status === 5) throw new StepBackError("הפריט במחקר — הוא חוזר למסלול דרך עמדת המחקר.", 409);
      if (row.current_status !== 2) throw new StepBackError("הפריט לא ממתין בעמדה, ולכן אי אפשר להחזיר אותו.", 409);
      if (row.current_route_step !== shownStep) throw new StepBackError("הפריט זז בינתיים. רענן את התור ונסה שוב.", 409);

      const step = row.current_route_step;
      if (step <= 1) throw new StepBackError("זו העמדה הראשונה במסלול — אין עמדה קודמת.", 409);
      const steps = row.route_steps ?? [];
      const toTypeId = steps[step - 2] != null ? Number(steps[step - 2]) : null;
      const fromTypeId = steps[step - 1] != null ? Number(steps[step - 1]) : null;
      if (toTypeId == null) throw new StepBackError("העמדה הקודמת לא נמצאה במסלול.", 409);

      const toType = await tx.test_stations_type.findUnique({
        where: { test_station_type_id: toTypeId },
        select: { test_type_desc: true },
      });
      const toTypeDesc = toType?.test_type_desc?.trim() ?? "";
      if (await isPackageLevelStationType(tx, toTypeId)) {
        throw new StepBackError(`העמדה הקודמת (${toTypeDesc}) היא שלב של המארז כולו — אי אפשר להחזיר אליה פריט בודד.`, 409);
      }

      const toStep = step - 1;
      const stationId = await findStationForRouteStep(tx, row.item_type_id, row.route_number, toStep);
      const now = new Date(getCurrentUtcIso());
      const moved = await tx.$executeRaw`
        UPDATE item_routes
           SET current_route_step = ${toStep}, current_status = 2, queue_start_time = ${now}::timestamp,
               processing_start_time = NULL, test_station_id = ${stationId}
         WHERE item_id = ${itemIdBig} AND current_status = 2 AND current_route_step = ${step}
           AND finished_at IS NULL
      `;
      if (moved === 0) throw new StepBackError("הפריט זז בינתיים. רענן את התור ונסה שוב.", 409);

      // Queued at the earlier step: station NULL by construction for a waiting
      // item (the fold takes the type from the run's plan), as on a normal advance.
      const payload = { action: "step_back", from_step: step, to_step: toStep, from_station_type_id: fromTypeId, to_station_type_id: toTypeId };
      await recordTransition(tx, {
        eventKey: `step_back:${actionId}:${itemIdBig}`,
        itemId: itemIdBig,
        toState: "queued",
        stepNo: toStep,
        stationId: null,
        stationTypeId: null,
        workerId,
        workerName,
        reason: "manual_override",
        submitId: actionId,
        payload,
      });
      if (stationId != null) {
        await recordNote(tx, {
          eventKey: `station_reassigned:${actionId}:${itemIdBig}:1`,
          itemId: itemIdBig,
          stepNo: toStep,
          stationId,
          workerId,
          workerName,
          reason: "station_reassigned",
          submitId: actionId,
          seq: 1,
          payload: { ...payload, station_id: stationId, site: "step_back" },
        });
      }

      // An item inside a box moved: the box's gate may have to wait for it again.
      if (pkgCtx?.packageId != null) {
        await recheckPackageReadiness(tx, pkgCtx.packageId, { submitId: actionId, workerId, workerName });
      }

      const station = stationId != null
        ? await tx.test_stations.findUnique({ where: { test_station_id: stationId }, select: { test_station_desc: true } })
        : null;
      return {
        itemId: String(itemIdBig),
        routeStep: toStep,
        stationTypeId: toTypeId,
        stationTypeDesc: toTypeDesc,
        stationId,
        stationDesc: station?.test_station_desc?.trim() ?? null,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StepBackError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error stepping item back:", error);
    return NextResponse.json({ error: "שגיאה בהחזרת הפריט לעמדה הקודמת" }, { status: 500 });
  }
}, { role: "manager" });
