import { TransactionClient } from "@/lib/db";
import { isFreshRoute, isOpeningRoute } from "./rules";

/**
 * Has anyone worked on these rows (a box and its items) since intake? A box
 * fresh from intake waits at step 1, queued (status 2), not started, with no
 * station history, results, research or attachments.
 *
 * The intake's "בטל" (boxes.ts undoIntake) takes a box back only while this
 * answers null. Past that point deleting belongs to the package page, with its
 * own warning.
 * The answer is the reason, in Hebrew, for the refusal text.
 *
 * `atOpening`: the box is open at its opening station, which starts its items
 * along with it (status 1 at step 1) — an item still there and with nothing
 * recorded on it is untouched for removing it as "did not come".
 *
 * `noun`: what the reason talks about — "מארז" (default) or "פריט", for the
 * opening's single item. Both masculine, so the sentences read the same.
 */
export async function workDoneOn(tx: TransactionClient, ids: bigint[], opts: { atOpening?: boolean; noun?: "מארז" | "פריט" } = {}): Promise<string | null> {
  const noun = opts.noun ?? "מארז";
  const routes = await tx.item_routes.findMany({
    where: { item_id: { in: ids } },
    select: { current_route_step: true, current_status: true, processing_start_time: true, is_finished: true },
  });
  const untouched = opts.atOpening ? isOpeningRoute : isFreshRoute;
  if (routes.some((r) => !untouched(r))) {
    return `כבר התחילו לעבוד על ה${noun}`;
  }
  if (await tx.item_route_history.count({ where: { item_id: { in: ids } } })) return `ל${noun} כבר יש היסטוריית עמדות`;
  if (await tx.test_results.count({ where: { item_id: { in: ids } } })) return `ל${noun} כבר יש תוצאות בדיקה`;
  if (await tx.research_history.count({ where: { item_id: { in: ids } } })) return `ה${noun} כבר נשלח למחקר`;
  const files = await tx.file_objects.count({
    where: { entity_type: "item_attachment", entity_id: { in: ids.map(String) }, status: "active" },
  });
  if (files) return `ל${noun} כבר צורפו קבצים`;
  return null;
}
