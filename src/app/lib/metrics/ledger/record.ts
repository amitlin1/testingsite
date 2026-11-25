// The single TypeScript entry point to the metrics ledger (§4.3 of
// docs/dashboard-migration-plan-v2.md). Every emission goes through
// metrics_record() in the DB, which owns occurred_at (clock + per-item clamp),
// idempotency (event_key), collision detection and run auto-open. Client
// timestamps are NEVER sent — the DB assigns event time.
import { randomUUID } from "crypto";
import type { TransactionClient } from "@/lib/db";
import type { MetricsReason, StateKey } from "../vocabulary";

/**
 * Which parts make an event's key (§4.4: the key carries the transition's identity, not just the
 * human action), joined with ":" in this order — name, action, item, seq, a fresh uuid. These are
 * the bytes the ledger has always stored: scripts/seed-dev-dataset.mjs reads the action back out
 * of them. (The reaper's released_stale keys are built in its own SQL.)
 */
export type EventKeyParts = {
  /** The key's first part, when it is not the event's reason. */
  name?: string;
  /** The human action (the actor's action id), when the key carries one. */
  actionId?: string;
  /** The event's item id is in the key. */
  item?: boolean;
  /** The event's seq is in the key: one action moves the item more than once. */
  seq?: boolean;
  /** A fresh uuid ends the key: the action has no id of its own, and its event is recorded only
   *  when a row actually flipped. */
  unique?: boolean;
};

export type MetricsTransition = {
  key: EventKeyParts;
  itemId: bigint;
  toState: StateKey | null;
  stepNo: number;
  stationId?: number | null;
  stationTypeId?: number | null;
  workerId?: number | null;
  workerName?: string | null;
  reason: MetricsReason;
  submitId?: string | null;
  kind?: "transition" | "note" | "correction";
  seq?: number;
  payload?: Record<string, unknown>;
};

/** The event_key an event is recorded under (EventKeyParts). */
export function eventKeyOf(e: Pick<MetricsTransition, "key" | "reason" | "itemId" | "seq">): string {
  const parts: string[] = [e.key.name ?? e.reason];
  if (e.key.actionId != null) parts.push(e.key.actionId);
  if (e.key.item) parts.push(String(e.itemId));
  if (e.key.seq) parts.push(String(e.seq ?? 0));
  if (e.key.unique) parts.push(randomUUID());
  return parts.join(":");
}

/** MUST be called with the SAME tx handle as the item_routes write (§4.8 —
 *  event, fold and item_routes are one transaction; that is the core
 *  guarantee). Replay of the same event_key returns the existing event_id
 *  with zero side effects; a key collision RAISEs inside the DB. */
export async function recordTransition(
  tx: TransactionClient, t: MetricsTransition
): Promise<bigint> {
  const eventKey = eventKeyOf(t);
  const rows = await tx.$queryRaw<{ event_id: bigint }[]>`
    SELECT metrics_record(
      ${eventKey}, ${t.itemId}::bigint, ${t.toState}, ${t.stepNo},
      ${t.stationId ?? null}::int, ${t.stationTypeId ?? null}::int,
      ${t.workerId ?? null}::int, ${t.workerName ?? null},
      ${t.reason}, ${t.submitId ?? null}::uuid, ${t.kind ?? "transition"},
      ${t.seq ?? 0}::smallint, ${JSON.stringify(t.payload ?? {})}::jsonb
    ) AS event_id`;
  const id = rows[0]?.event_id;
  if (id == null) throw new Error(`metrics_record returned NULL for ${eventKey}`);
  return id;
}

export type MetricsNote = Omit<MetricsTransition, "toState" | "kind">;

/** kind='note' emission (research_note, station_reassigned): hangs off the
 *  item's run for audit/anchoring but never opens or closes an interval.
 *
 *  Unlike a transition, a note is BEST-EFFORT and returns null instead of
 *  throwing when the DB has nothing to hang it on (an orphan item_routes row
 *  with no items row). A transition carries the invariant and must never be
 *  lost — a note is auxiliary audit data, and losing one must never turn a
 *  worker's save into a 500. */
export async function recordNote(
  tx: TransactionClient, n: MetricsNote
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<{ event_id: bigint | null }[]>`
    SELECT metrics_record(
      ${eventKeyOf(n)}, ${n.itemId}::bigint, NULL, ${n.stepNo},
      ${n.stationId ?? null}::int, ${n.stationTypeId ?? null}::int,
      ${n.workerId ?? null}::int, ${n.workerName ?? null},
      ${n.reason}, ${n.submitId ?? null}::uuid, 'note',
      ${n.seq ?? 0}::smallint, ${JSON.stringify(n.payload ?? {})}::jsonb
    ) AS event_id`;
  return rows[0]?.event_id ?? null;
}
