// The single TypeScript entry point to the metrics ledger (§4.3 of
// docs/dashboard-migration-plan-v2.md). Every emission goes through
// metrics_record() in the DB, which owns occurred_at (clock + per-item clamp),
// idempotency (event_key), collision detection and run auto-open. Client
// timestamps are NEVER sent — the DB assigns event time.
import { TransactionClient } from "@/app/lib/prisma";

/** Full reason taxonomy (§3.4). `correction` is listed for completeness but is
 *  a manual-SQL path — metrics_record is not the API for corrections. */
export type MetricsReason =
  | "item_created"
  | "test_started"
  | "released_by_user"
  | "released_stale"
  | "result_submitted"
  | "sent_to_research"
  | "returned_to_route"
  | "research_note"
  | "no_station_for_type"
  | "station_reassigned"
  | "manual_override"
  | "legacy_import"
  | "correction";

export type MetricsTransition = {
  eventKey: string;
  itemId: bigint;
  toState: "queued" | "testing" | "done" | "queued_research" | "in_research" | "unmapped" | null;
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

/** MUST be called with the SAME tx handle as the item_routes write (§4.8 —
 *  event, fold and item_routes are one transaction; that is the core
 *  guarantee). Replay of the same event_key returns the existing event_id
 *  with zero side effects; a key collision RAISEs inside the DB. */
export async function recordTransition(
  tx: TransactionClient, t: MetricsTransition
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ event_id: bigint }[]>`
    SELECT metrics_record(
      ${t.eventKey}, ${t.itemId}::bigint, ${t.toState}, ${t.stepNo},
      ${t.stationId ?? null}::int, ${t.stationTypeId ?? null}::int,
      ${t.workerId ?? null}::int, ${t.workerName ?? null},
      ${t.reason}, ${t.submitId ?? null}::uuid, ${t.kind ?? "transition"},
      ${t.seq ?? 0}::smallint, ${JSON.stringify(t.payload ?? {})}::jsonb
    ) AS event_id`;
  const id = rows[0]?.event_id;
  if (id == null) throw new Error(`metrics_record returned NULL for ${t.eventKey}`);
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
      ${n.eventKey}, ${n.itemId}::bigint, NULL, ${n.stepNo},
      ${n.stationId ?? null}::int, ${n.stationTypeId ?? null}::int,
      ${n.workerId ?? null}::int, ${n.workerName ?? null},
      ${n.reason}, ${n.submitId ?? null}::uuid, 'note',
      ${n.seq ?? 0}::smallint, ${JSON.stringify(n.payload ?? {})}::jsonb
    ) AS event_id`;
  return rows[0]?.event_id ?? null;
}
