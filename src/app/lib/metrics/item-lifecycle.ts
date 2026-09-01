// The ledger's second entry point, alongside record.ts.
//
// record.ts covers everything an item *does* — every transition goes through
// metrics_record(). This file covers the two things that happen to an item
// itself: it gets deleted, or its master data gets corrected. Neither is an
// event (there is no state change to record, and after a delete there is no
// subject left), so each is a function of its own in the DB.
//
// All three MUST be called with the same tx handle as the write they follow,
// for the same reason record.ts must (§4.8): the ledger and the operational
// tables commit together or not at all.
import { TransactionClient } from "@/app/lib/prisma";

/** Erase every ledger row belonging to an item being hard-deleted: its runs,
 *  events, intervals and drift rows. Without it the item keeps an open
 *  interval nothing points at, and every dashboard number keeps counting it —
 *  silently, because the ledger holds no FK to `items` on purpose.
 *
 *  Idempotent; returns the number of intervals removed. */
export async function forgetItem(tx: TransactionClient, itemId: bigint): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT metrics_forget_item(${itemId}::bigint) AS n`;
  return rows[0]?.n ?? 0;
}

/** Re-freeze the item's dimensions (customer, shipment, type, serial, unit)
 *  onto its runs and intervals after `items` was edited. Reads them back from
 *  items/item_routes rather than taking them as arguments, so it cannot drift
 *  from the way metrics_open_run froze them.
 *
 *  Returns the number of runs actually changed. */
export async function resyncItemDims(tx: TransactionClient, itemId: bigint): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT metrics_resync_item_dims(${itemId}::bigint) AS n`;
  return rows[0]?.n ?? 0;
}

/** End the item's open run without counting it as finished: closes the open
 *  interval and the run, and marks the run `is_trusted = false`.
 *
 *  For a type change, which sends the item back to the start of a different
 *  route. "Finished" is a run closure, so an ordinary close would report the
 *  item as delivered; every completion query carries `rr.is_trusted`, so an
 *  untrusted run stays in the audit trail and out of the numbers.
 *
 *  Record a fresh `queued` transition afterwards — with item_routes already
 *  pointing at the new type — and metrics_record opens the next run against the
 *  new route's plan.
 *
 *  Returns the abandoned route_run_id, or null when there was no open run. */
export async function abandonRun(
  tx: TransactionClient, itemId: bigint, reason: string
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<{ run: bigint | null }[]>`
    SELECT metrics_abandon_run(${itemId}::bigint, ${reason}) AS run`;
  return rows[0]?.run ?? null;
}
