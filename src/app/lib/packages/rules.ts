import { ItemStatus, isAtStepStatus, isInTestStatus } from "@/lib/item-status";
import type { PackageItemState, PackageStatusKey } from "./contract";

/**
 * The package model's rules over a route row (item_routes) — pure, so the
 * write path, the read path and the tests ask the same questions the same way
 * (docs/packages/PLAN.md §4).
 */

type RoutePos = { current_route_step: number | null; current_status: number | null; is_finished: boolean | null };

/** At the box's opening: step 1, waiting or open there, not finished. Only
 *  the opening station changes what is in a box. */
export function isOpeningRoute(r: RoutePos): boolean {
  return r.current_route_step === 1 && !r.is_finished && isAtStepStatus(r.current_status);
}

/** Fresh from intake: step 1, queued, never started, not finished. */
export function isFreshRoute(r: RoutePos & { processing_start_time: Date | null }): boolean {
  return r.current_route_step === 1 && r.current_status === ItemStatus.Queued && r.processing_start_time == null && !r.is_finished;
}

/** The box waits at its gate: it is not finished and sits at a package-level step after its first
 *  (the opening step needs no readiness — every item is created there). */
export function atGateStep(
  box: { current_route_step: number | null; is_finished: boolean | null },
  stepPackageLevel: boolean | null | undefined,
): boolean {
  return !box.is_finished && (box.current_route_step ?? 1) > 1 && stepPackageLevel === true;
}

/**
 * Does this member keep its box out of the closing queue? The box waits at a
 * package-level step after its first (the gate, of station type
 * `gateStepTypeId`). A member is present when it finished its route (it will
 * not come — the closing wizard reports it as not arrived) or when its current
 * step is that same station type and it is waiting or in test there.
 * Anything else — mid-route, in research, waiting for research — blocks. An
 * items row without a route row (an orphan) has nothing to wait for.
 */
export function blocksGate(m: { current_status: number | null; is_finished: boolean | null; step_type_id: number | null }, gateStepTypeId: number): boolean {
  if (m.is_finished) return false;
  if (m.current_status == null) return false;
  return !(m.step_type_id === gateStepTypeId && isAtStepStatus(m.current_status));
}

/** A closing decision recorded on the box (its closing step's result details). */
export type PackDecision = { item_id: string; decision: "packed" | "packed_anyway" | "missing"; note: string | null };

export function decisionsOf(details: unknown): PackDecision[] {
  if (!details || typeof details !== "object") return [];
  const d = (details as { decisions?: unknown }).decisions;
  if (!Array.isArray(d)) return [];
  return d
    .filter((x) => x && typeof x === "object" && "item_id" in x && "decision" in x)
    .map((x) => ({ item_id: String((x as PackDecision).item_id), decision: (x as PackDecision).decision, note: (x as PackDecision).note ?? null }));
}

const isDone = (r: { is_finished: boolean | null; current_status: number | null }) => r.is_finished || r.current_status === ItemStatus.Done;

/** An item's state inside its box, as the package screens show it. */
export function itemState(
  m: RoutePos,
  box: { current_route_step: number | null; is_finished: boolean | null },
  decision: PackDecision | undefined,
): PackageItemState {
  if (decision?.decision === "missing") return "missing";
  if (isDone(m)) return "done";
  if (isInTestStatus(m.current_status)) return "test";
  const boxNotOpened = (box.current_route_step ?? 1) <= 1 && !box.is_finished;
  if (boxNotOpened && (m.current_route_step ?? 1) <= 1) return "new";
  return "queue";
}

/** Where an item is right now, in words: its station, "ממתין ל<type>", or null when it is done. */
export function itemWhereText(m: RoutePos & { station_name: string | null; step_type_desc: string | null }): string | null {
  if (isDone(m)) return null;
  if (isInTestStatus(m.current_status) && m.station_name) return m.station_name.trim();
  if (m.current_status === ItemStatus.AwaitResearch) return "ממתין למחקר";
  if (m.step_type_desc) return `ממתין ל${m.step_type_desc.trim()}`;
  return null;
}

/** A box's status. `routed`: it has its route row (taken in); `blocked`:
 *  how many members keep it out of the closing queue. */
export function packageStatus(box: RoutePos & { routed: boolean }, blocked: number): PackageStatusKey {
  if (!box.routed) return "pending";
  if (isDone(box)) return "done";
  if (isInTestStatus(box.current_status)) return "test";
  if (box.current_status === ItemStatus.AwaitPackageItems) return "waitItems";
  const step = box.current_route_step ?? 1;
  if (step <= 1) return "queue";
  // Queued at a later step: the closing queue, unless something still blocks
  // (a race between the gate and this read — report what the items say).
  return blocked > 0 ? "waitItems" : "readyClose";
}

/** The member is at the closing step (its route's last), waiting or in test there. */
export function arrivedAtClosing(m: RoutePos & { step_type_id: number | null; last_step_type_id: number | null }): boolean {
  return !isDone(m) &&
    m.step_type_id != null && m.step_type_id === m.last_step_type_id &&
    (m.current_route_step ?? 0) > 1 &&
    isAtStepStatus(m.current_status);
}
