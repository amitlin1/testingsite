import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { ItemStatus, isResearchStatus } from "@/lib/item-status";
import { recordNote, recordTransition } from "@/app/lib/metrics/ledger/record";
import { isPackageLevelStationType, loadPackageContext } from "@/app/lib/packages/context";
import { recheckPackageReadiness } from "@/app/lib/packages/readiness";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import type { Actor } from "./actor";
import type { StepBackAnswer } from "./contract";
import { openClosingOf, releaseClosing } from "./group";

/** A refusal the worker reads as it is (Hebrew). */
const refuse = (message: string, status = 409) => new HttpError(status, message);
const MOVED = "הפריט זז בינתיים. רענן את התור ונסה שוב.";

/**
 * "חזרה לבדיקה הקודמת": a WAITING item goes one step back on its route and waits again at the
 * station type of the step before, to be tested there anew. Nothing is deleted — the earlier result
 * stays in the history, and the item report prints a step's latest result, so the new one replaces
 * it there.
 *
 * Refused (409, the reason in words): an item in test or in research, a finished one, one at the
 * first step, a whole box, and a step back onto a package-level step (the box opening is the whole
 * box's, not one item's).
 *
 * One item in test is taken: an item of a box whose closing is open — the closing wizard's "החזר".
 * The box and its items are in test there together (the group start, packages PLAN §4), so the
 * closing stops first: the box and every item started with it go back to waiting, then the item
 * goes back, and the box's gate makes it wait for that item. `shownStep` is the step the card
 * showed: the UPDATE matches only that step and status, so two clicks never take the item back twice.
 *
 * Ledger: a "queued" transition at the earlier step, reason manual_override (payload.action =
 * "step_back", payload.reason = the worker's words: why it goes back, required) — the metrics count
 * it as that step's next attempt; the item report lists these, with who and why (item-report/source). An item inside a box rechecks
 * the box's gate in the same tx.
 */
/** The longest reason a step back takes (its words print on the item's report). */
export const STEP_BACK_REASON_MAX = 500;

export function stepBack({ itemId, shownStep, reason, actor }: { itemId: bigint; shownStep: number; reason: string; actor: Actor }): Promise<StepBackAnswer> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{
      item_type_id: number; route_number: number; current_status: number;
      current_route_step: number; is_finished: boolean; route_steps: number[] | null;
      test_station_id: number | null;
    }[]>`
      SELECT ir.item_type_id, ir.route_number, ir.current_status, ir.current_route_step,
             ir.is_finished, tr.route_steps, ir.test_station_id
        FROM item_routes ir
        LEFT JOIN testing_routes tr
          ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
       WHERE ir.item_id = ${itemId}
       FOR UPDATE OF ir
    `;
    const row = rows[0];
    if (!row) throw refuse("הפריט לא נמצא", 404);

    const pkgCtx = await loadPackageContext(tx, itemId);
    if (pkgCtx?.isPackage) throw refuse("מארז שלם לא מוחזר מכאן — רק פריט בודד.");
    if (row.is_finished || row.current_status === ItemStatus.Done) throw refuse("הפריט סיים את המסלול.");
    const steps = row.route_steps ?? [];
    const fromTypeId = steps[row.current_route_step - 1] != null ? Number(steps[row.current_route_step - 1]) : null;
    // In test: only inside its box's open closing (the closing wizard).
    const closing = row.current_status === ItemStatus.InTest && pkgCtx?.packageId != null
      ? await openClosingOf(tx, pkgCtx.packageId, row.test_station_id, fromTypeId)
      : null;
    if (row.current_status === ItemStatus.InTest && !closing) throw refuse("הפריט בבדיקה כרגע. צריך לצאת מהבדיקה לפני שמחזירים אותו.");
    if (isResearchStatus(row.current_status)) throw refuse("הפריט במחקר — הוא חוזר למסלול דרך עמדת המחקר.");
    if (row.current_status !== ItemStatus.Queued && !closing) throw refuse("הפריט לא ממתין בעמדה, ולכן אי אפשר להחזיר אותו.");
    if (row.current_route_step !== shownStep) throw refuse(MOVED);

    const step = row.current_route_step;
    if (step <= 1) throw refuse("זו העמדה הראשונה במסלול — אין עמדה קודמת.");
    const toTypeId = steps[step - 2] != null ? Number(steps[step - 2]) : null;
    if (toTypeId == null) throw refuse("העמדה הקודמת לא נמצאה במסלול.");

    const toType = await tx.test_stations_type.findUnique({
      where: { test_station_type_id: toTypeId },
      select: { test_type_desc: true },
    });
    const toTypeDesc = toType?.test_type_desc?.trim() ?? "";
    if (await isPackageLevelStationType(tx, toTypeId)) {
      throw refuse(`העמדה הקודמת (${toTypeDesc}) היא שלב של המארז כולו — אי אפשר להחזיר אליה פריט בודד.`);
    }

    const toStep = step - 1;
    const stationId = await findStationForRouteStep(tx, row.item_type_id, row.route_number, toStep);
    const now = new Date();

    // The closing stops: the box and the items started with it wait again — this item too, so the
    // UPDATE below finds it waiting like any other.
    if (closing) await releaseClosing(tx, closing, now, actor);
    const moved = await tx.$executeRaw`
      UPDATE item_routes
         SET current_route_step = ${toStep}, current_status = ${ItemStatus.Queued}, queue_start_time = ${now}::timestamp,
             processing_start_time = NULL, test_station_id = ${stationId}
       WHERE item_id = ${itemId} AND current_status = ${ItemStatus.Queued} AND current_route_step = ${step}
         AND finished_at IS NULL
    `;
    if (moved === 0) throw refuse(MOVED);

    // Station NULL by construction for a waiting item (the fold takes the type from the run's
    // plan), as on a normal advance.
    const payload = { action: "step_back", from_step: step, to_step: toStep, from_station_type_id: fromTypeId, to_station_type_id: toTypeId, reason };
    await recordTransition(tx, {
      key: { name: "step_back", actionId: actor.actionId, item: true },
      itemId,
      toState: "queued",
      stepNo: toStep,
      stationId: null,
      stationTypeId: null,
      workerId: actor.workerId,
      workerName: actor.workerName,
      reason: "manual_override",
      submitId: actor.actionId,
      payload,
    });
    if (stationId != null) {
      await recordNote(tx, {
        key: { actionId: actor.actionId, item: true, seq: true },
        itemId,
        stepNo: toStep,
        stationId,
        workerId: actor.workerId,
        workerName: actor.workerName,
        reason: "station_reassigned",
        submitId: actor.actionId,
        seq: 1,
        payload: { ...payload, station_id: stationId, site: "step_back" },
      });
    }

    if (pkgCtx?.packageId != null) {
      await recheckPackageReadiness(tx, pkgCtx.packageId, { submitId: actor.actionId, workerId: actor.workerId, workerName: actor.workerName });
    }

    const station = stationId != null
      ? await tx.test_stations.findUnique({ where: { test_station_id: stationId }, select: { test_station_desc: true } })
      : null;
    return {
      itemId: String(itemId),
      routeStep: toStep,
      stationTypeId: toTypeId,
      stationTypeDesc: toTypeDesc,
      stationId,
      stationDesc: station?.test_station_desc?.trim() ?? null,
      closingStopped: closing != null,
    } satisfies StepBackAnswer;
  });
}
