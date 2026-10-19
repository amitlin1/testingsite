import { TransactionClient } from "@/app/lib/prisma";

/**
 * Has anyone worked on these rows (a box and its items) since intake? A box
 * fresh from intake waits at step 1, queued (status 2), not started, with no
 * station history, results, research or attachments.
 *
 * The intake's "בטל מארז אחרון" deletes a box only while this answers null.
 * Past that point deleting belongs to the package page, with its own warning.
 * The answer is the reason, in Hebrew, for the refusal text.
 *
 * `atOpening`: the box is open at its opening station, which starts its items
 * along with it (status 1 at step 1) — an item still there and with nothing
 * recorded on it is untouched for removing it as "did not come".
 */
export async function workDoneOn(tx: TransactionClient, ids: bigint[], opts: { atOpening?: boolean } = {}): Promise<string | null> {
  const routes = await tx.item_routes.findMany({
    where: { item_id: { in: ids } },
    select: { current_route_step: true, current_status: true, processing_start_time: true, is_finished: true },
  });
  const moved = opts.atOpening
    ? (r: (typeof routes)[number]) => r.current_route_step !== 1 || r.is_finished || (r.current_status !== 1 && r.current_status !== 2)
    : (r: (typeof routes)[number]) => r.current_route_step !== 1 || r.current_status !== 2 || r.processing_start_time != null || r.is_finished;
  if (routes.some(moved)) {
    return "כבר התחילו לעבוד על המארז";
  }
  if (await tx.item_route_history.count({ where: { item_id: { in: ids } } })) return "למארז כבר יש היסטוריית עמדות";
  if (await tx.test_results.count({ where: { item_id: { in: ids } } })) return "למארז כבר יש תוצאות בדיקה";
  if (await tx.research_history.count({ where: { item_id: { in: ids } } })) return "המארז כבר נשלח למחקר";
  const files = await tx.file_objects.count({
    where: { entity_type: "item_attachment", entity_id: { in: ids.map(String) }, status: "active" },
  });
  if (files) return "למארז כבר צורפו קבצים";
  return null;
}
