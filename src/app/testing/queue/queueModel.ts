import type { PackageItemView } from "@/app/lib/packages/contract";
import type { NextStation, QueueRow, TestStationType } from "@/app/lib/testing/contract";
import { packageRoleOf } from "@/app/lib/testing/popup-kind";
import { ItemStatus, isInTestStatus, isWaitingStatus } from "@/lib/item-status";
import { isSourcedLabel, labelIdText } from "@/app/lib/packages/ids";

/**
 * The station queue as the screen shows it: which rows the search keeps, in what order, the
 * summary counts, and which rows offer "חזרה לבדיקה הקודמת". Pure. The tree around them is
 * treeModel.ts.
 */

/** Every filter of the queue (all in the URL): empty = everything. */
export type QueueFilters = { q: string; customer: string; shipment: string; itype: string };

const has = (v: unknown, ql: string) => v != null && String(v).toLowerCase().includes(ql);

/** The rows the search text and the three filters keep. The text matches an item's ids, serial,
 *  SKU, customer, shipment or type; a box row is found by any of its items too. */
export function filterQueue(items: readonly QueueRow[], f: QueueFilters): QueueRow[] {
  const ql = f.q.trim().toLowerCase();
  // A label printed before the source left the barcode reads "itemId-sourceId": the id part names
  // the item, the suffix is in no field, so the whole code alone would match nothing.
  const labelId = isSourcedLabel(ql) ? labelIdText(ql) : null;
  const isId = (v: unknown) => labelId != null && v != null && String(v) === labelId;
  return items.filter((item) =>
    (f.customer === "" || String(item.customer_id) === f.customer) &&
    (f.shipment === "" || String(item.shipment_id) === f.shipment) &&
    (f.itype === "" || String(item.item_type_id) === f.itype) &&
    (ql === "" ||
      has(item.makat, ql) || has(item.serial_no, ql) || has(item.item_id, ql) || has(item.customer_code, ql) ||
      has(item.shipment_code, ql) || has(item.item_type_desc, ql) || has(item.package_id, ql) ||
      isId(item.item_id) || isId(item.package_id) ||
      // An item row's `package` is its parent box: only a box row is found by its items.
      (!!item.is_package && (item.package?.items ?? []).some((it) => has(it.item_id, ql) || has(it.serial_no, ql) || isId(it.item_id)))),
  );
}

const rankOf = (it: QueueRow) => (isWaitingStatus(it.current_status) ? 0 : isInTestStatus(it.current_status) ? 1 : 2);
const baseTimeOf = (it: QueueRow) => new Date(it.queue_start_time || it.processing_start_time || 0).getTime();

/**
 * Waiting first (the longest wait first), then in test, then the rest; the scanned row first of
 * all. The longest-waiting row gets the priority ribbon — not while the search text narrows the
 * queue.
 */
export function orderQueue(rows: readonly QueueRow[], { searching, highlightedItemId }: { searching: boolean; highlightedItemId: number | null }) {
  const sorted = [...rows].sort((a, b) => rankOf(a) - rankOf(b) || baseTimeOf(a) - baseTimeOf(b));
  const topWaiting = searching ? undefined : sorted.find((it) => isWaitingStatus(it.current_status));
  if (highlightedItemId != null) {
    const idx = sorted.findIndex((it) => it.item_id === highlightedItemId);
    if (idx > 0) sorted.unshift(...sorted.splice(idx, 1));
  }
  return { orderedItems: sorted, priorityItemId: topWaiting?.item_id ?? null };
}

/** The summary strip's numbers, from the whole queue (not the filtered one). */
export function queueSummary(items: readonly QueueRow[]) {
  let waiting = 0;
  let inTest = 0;
  let longestWaitStart: string | null = null;
  for (const it of items) {
    if (isWaitingStatus(it.current_status)) {
      waiting++;
      if (it.queue_start_time && (longestWaitStart == null || new Date(it.queue_start_time).getTime() < new Date(longestWaitStart).getTime())) {
        longestWaitStart = it.queue_start_time;
      }
    } else if (isInTestStatus(it.current_status)) {
      inTest++;
    }
  }
  return { waiting, inTest, longestWaitStart };
}

/** The row a code typed in the search field names in this queue: by id (a label's id part) or by
 *  its exact serial. */
export function queueRowOfCode(items: readonly QueueRow[], code: string): QueueRow | undefined {
  const id = labelIdText(code);
  return items.find((it) => String(it.item_id) === id || (it.serial_no ?? "") === code);
}

// ---- "חזרה לבדיקה הקודמת" (api/testing/step-back) -------------------------------------------
// Who may send what back, decided here once: whoever holds ACCESS.stepBack (the route answers
// anyone else 403 and checks everything again). Each rule answers the request, or null where the
// button is not offered.

/** One item, one step back: the step it waits at now (the route moves it only from that step) and
 *  the station type it goes back to. */
export type StepBackRequest = {
  itemId: string; routeStep: number; toName: string; inBox: boolean;
  /** Asked from inside the box's closing wizard: the closing stops, the wizard closes. */
  fromWizard?: boolean;
};

/** A waiting queue item: back to the step before — not from the first step, not a box, and not
 *  when the step before is the whole box's (its opening). */
export function queueItemStepBack(item: QueueRow, stationTypes: readonly TestStationType[], canStepBack: boolean): StepBackRequest | null {
  const step = item.current_route_step ?? 1;
  if (!canStepBack || item.current_status !== ItemStatus.Queued || item.is_package || step <= 1) return null;
  const prevTypeId = item.route_steps?.[step - 2];
  const prev = prevTypeId != null ? stationTypes.find((t) => t.id === Number(prevTypeId)) : undefined;
  return prev && !prev.packageLevel ? { itemId: String(item.item_id), routeStep: step, toName: prev.name, inBox: false } : null;
}

/** An item of a box that reached its closing: back to the test before it, when that step is its own
 *  (not the box's opening). From the closing queue (`box`: the box's row) only while the box and the
 *  item still wait there; from the closing wizard ("wizard") its closing stops. */
export function boxItemStepBack(it: PackageItemView, canStepBack: boolean, from: { box: QueueRow } | "wizard"): StepBackRequest | null {
  if (!canStepBack || !it.arrived_at_closing || it.prev_step_desc == null || it.prev_step_package_level || it.current_route_step == null) return null;
  if (from !== "wizard") {
    const { box } = from;
    if (box.current_status !== ItemStatus.Queued || packageRoleOf(box) !== "closing" || it.current_status !== ItemStatus.Queued) return null;
  }
  return { itemId: it.item_id, routeStep: it.current_route_step, toName: it.prev_step_desc, inBox: true, fromWizard: from === "wizard" };
}

/** Right after an item's result at a station of `type`: back to the test it just finished, from the
 *  step it now waits at — not after its last step, not at a box's own station (opening / closing),
 *  not in research. */
export function afterResultStepBack(
  item: QueueRow, type: TestStationType, answer: { isLastStation?: boolean; nextStation?: NextStation | null }, canStepBack: boolean,
): StepBackRequest | null {
  if (!canStepBack || type.packageLevel || item.current_status === ItemStatus.InResearch || answer.isLastStation || !answer.nextStation) return null;
  return { itemId: String(item.item_id), routeStep: answer.nextStation.routeStep, toName: type.name, inBox: false };
}

/** The step a request sends the item back to. */
export const stepBackTo = (req: StepBackRequest): number => req.routeStep - 1;
