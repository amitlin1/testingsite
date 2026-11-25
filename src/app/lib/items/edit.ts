import { sendJson } from "@/lib/api/client";
import type { ItemEditBody } from "./contract";

/** What PUT /api/items/[id] answers on success. */
export type ItemEditResult = { ok: true; item_id: string; retyped: boolean; packageReset: string[] | null };

/**
 * Saves an item: PUT /api/items/[id] with every editable field (the route
 * replaces them all, so an edit of one field resends the rest). A refusal
 * throws ApiError with the server's text and `code` in its body.
 */
export function saveItem(itemId: string | number, body: ItemEditBody): Promise<ItemEditResult> {
  return sendJson<ItemEditResult>(`/api/items/${itemId}`, "PUT", body, "עדכון הפריט נכשל");
}

/**
 * Deletes an item (or a box with `cascade`, which takes its items along):
 * DELETE /api/items/[id]. A box with items, sent without `cascade`, is refused
 * with 409 and the items in the body's `connectedItems`.
 */
export function deleteItem(itemId: string | number, cascade = false): Promise<{ ok: true; deletedConnectedCount: number }> {
  return sendJson(`/api/items/${itemId}`, "DELETE", cascade ? { cascade: true } : undefined, "מחיקת הפריט נכשלה");
}
