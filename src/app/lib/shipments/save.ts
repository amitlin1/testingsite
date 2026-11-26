import type { Session } from "next-auth";
import type { shipments } from "@prisma/client";
import { prisma, TransactionClient } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId } from "@/lib/http/request";
import { anyBoxTakenIn, dropPendingBoxesOfSentShipment, dropShipmentBoxes, syncShipmentBoxes } from "@/app/lib/packages/boxes";
import { SHIPMENT_CODE_MAX, duplicateKey, type BoxSync } from "./contract";
import { duplicateShipmentError, findDuplicateShipment, readShipmentLines, saveShipmentLines, type ShipmentLineInput } from "./lines";
import { nonPackageTypeIds } from "./line-details";
import { maxToSend, remainingLines, type DeclaredLine, type SentRow } from "./send";
import { resolveShipmentWorker, type ShipmentWorker } from "./worker";

/**
 * The shipment write path (POST / PUT / DELETE /api/shipments): every save
 * runs the same order — the duplicate check, the shipments row, its lines
 * (lines.ts), then the boxes follow the lines (lib/packages/boxes.ts
 * syncShipmentBoxes) — in one transaction.
 */

/** Interactive-transaction limits for a shipment save (the default 5s ran
 *  out at about 650 boxes). */
export const SHIPMENT_TX = { maxWait: 5_000, timeout: 30_000 } as const;

export type ShipmentHeader = { shipment_code: string; customer_id: number; shipment_date: Date };

/** The certificate's number, customer and date, as both forms send them. */
export function readShipmentHeader(body: Record<string, unknown>): ShipmentHeader {
  const shipment_code = typeof body.shipment_code === "string" ? body.shipment_code.trim() : "";
  if (!shipment_code) throw new HttpError(400, "חסר מספר משלוח");
  if (shipment_code.length > SHIPMENT_CODE_MAX) throw new HttpError(400, `מספר משלוח ארוך מ-${SHIPMENT_CODE_MAX} תווים`);
  const customer_id = parseDbId(body.customer_id);
  if (customer_id == null) throw new HttpError(400, "חסר לקוח");
  const date = body.shipment_date as string | number | Date | null | undefined;
  if (!date || Number.isNaN(new Date(date).getTime())) throw new HttpError(400, "חסר תאריך משלוח");
  return { shipment_code, customer_id, shipment_date: new Date(date) };
}

/**
 * The declared lines, checked before anything is written. Package model
 * (docs/features/packages/PLAN.md §9.10): a shipment declares package TYPES only —
 * the items inside a box are never declared per shipment.
 */
export async function readDeclaredLines(body: Record<string, unknown>, shipmentCode: string): Promise<ShipmentLineInput[]> {
  const nonPackage = await nonPackageTypeIds(body.shipment_items as { item_type_id?: number | null }[] | null | undefined);
  if (nonPackage.length > 0) {
    throw new HttpError(400, "משלוח מצהיר על סוגי מארזים בלבד", { code: "SHIPMENT_TYPES_MUST_BE_PACKAGES", extra: { item_type_ids: nonPackage } });
  }
  return readShipmentLines(body.shipment_items, shipmentCode);
}

/** A worker field of a save, by the shipments rule (worker.ts); refused when nobody can be named. */
export function shipmentWorker(session: Session, submitted: ShipmentWorker, keep?: ShipmentWorker | null): ShipmentWorker {
  const r = resolveShipmentWorker(session, submitted, keep);
  if ("error" in r) throw new HttpError(400, r.error);
  return r.worker;
}

export type NewShipmentInput = ShipmentHeader & {
  lines: ShipmentLineInput[];
  amount: number;
  makat: string;
  receiver: ShipmentWorker;
  sender: ShipmentWorker;
  sourceId: number | null;
  poc: string | null;
  allowDuplicate: boolean;
};

/**
 * POST: the shipment, its lines and a pending box per declared unit, its id
 * minted now — the labels print from the shipment and the intake scans them.
 * The same certificate (number + customer) entered twice is refused with the
 * existing shipment unless the worker chose to enter it again.
 */
export async function createShipment(input: NewShipmentInput): Promise<shipments> {
  return prisma.$transaction(async (tx) => {
    const duplicate = await findDuplicateShipment(tx, input.shipment_code, input.customer_id);
    if (duplicate && !input.allowDuplicate) throw duplicateShipmentError(duplicate);

    const created = await tx.shipments.create({
      data: {
        shipment_code: input.shipment_code,
        customer_id: input.customer_id,
        shipment_date: input.shipment_date,
        makat: input.makat,
        amount: input.amount,
        recieving_worker_id: input.receiver.id,
        recieving_worker_name: input.receiver.name,
        signature_path: null,
        sending_worker_id: input.sender.id,
        sending_worker_name: input.sender.name,
        source_id: input.sourceId,
        poc_details: input.poc,
        // The moment it entered the system; shipment_date is the certificate's.
        received_at: new Date(),
      },
    });
    await saveShipmentLines(tx, created.id, input.lines);
    await syncShipmentBoxes(tx, created.id);
    return created;
  }, SHIPMENT_TX);
}

export type ShipmentUpdate = ShipmentHeader & {
  lines: ShipmentLineInput[];
  makat: string | null;
  receiver: ShipmentWorker;
  sender: ShipmentWorker;
  sourceId: number | null;
  allowDuplicate: boolean;
  /** The client sends line ids (lines.ts matchSavedLines); an older one is matched by type, in order. */
  byLineId: boolean;
};

/** A dry run's answer travels out of the transaction as a throw, so nothing commits. */
class DryRun {
  constructor(readonly boxes: BoxSync) {}
}

/**
 * PUT: the lines are saved in place by their line id, so every line keeps its
 * own boxes. `dryRun` does all of it and rolls back, answering what would
 * happen to the boxes — the form shows the labels that stop being valid
 * before the worker confirms.
 */
export async function updateShipment(
  shipmentId: number,
  existing: { shipment_code: string | null; customer_id: number },
  input: ShipmentUpdate,
  opts: { dryRun: boolean },
): Promise<{ shipment: shipments | null; boxes: BoxSync }> {
  const customerChanged = input.customer_id !== existing.customer_id;
  const certificateChanged = duplicateKey(input.shipment_code, input.customer_id) !== duplicateKey(existing.shipment_code, existing.customer_id);
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      if (certificateChanged) {
        const duplicate = await findDuplicateShipment(tx, input.shipment_code, input.customer_id, shipmentId);
        if (duplicate && !input.allowDuplicate) throw duplicateShipmentError(duplicate);
      }
      // The customer is in every box id and on everything taken in: once a
      // box was taken in, the shipment keeps its customer.
      if (customerChanged && await anyBoxTakenIn(tx, shipmentId)) {
        throw new HttpError(409, "מארזים מהמשלוח כבר נקלטו — אי אפשר לשנות את הלקוח", { code: "SHIPMENT_CUSTOMER_TAKEN_IN" });
      }

      // shipment_sent_date / sending_worker_*: a sender sent with an edit marks
      // the shipment sent (the old edit-to-send path; no form sends one now).
      const updated = await tx.$queryRaw<shipments[]>`
        UPDATE shipments
        SET shipment_code = ${input.shipment_code},
            customer_id = ${input.customer_id},
            shipment_date = ${input.shipment_date}::timestamp,
            amount = ${input.lines.reduce((sum, l) => sum + l.quantity, 0)},
            shipment_sent_date = CASE WHEN ${input.sender.id}::int IS NOT NULL AND shipment_sent_date IS NULL THEN ${now}::timestamp ELSE shipment_sent_date END,
            sending_worker_id = ${input.sender.id},
            sending_worker_name = ${input.sender.name},
            recieving_worker_id = ${input.receiver.id},
            recieving_worker_name = ${input.receiver.name},
            makat = COALESCE(${input.makat}, makat),
            source_id = ${input.sourceId}::int
        WHERE id = ${shipmentId}
        RETURNING *
      `;
      if (updated.length === 0) throw new HttpError(404, "המשלוח לא נמצא");

      const goneWithLines = await saveShipmentLines(tx, shipmentId, input.lines, input.byLineId);
      const synced = await syncShipmentBoxes(tx, shipmentId);
      const boxes: BoxSync = { ...synced, removed: [...goneWithLines, ...synced.removed] };
      if (opts.dryRun) throw new DryRun(boxes);
      return { shipment: updated[0], boxes };
    }, SHIPMENT_TX);
  } catch (e) {
    if (e instanceof DryRun) return { shipment: null, boxes: e.boxes };
    throw e;
  }
}

/** DELETE: the shipment with its lines and its pending boxes; a box already
 *  taken in refuses it, unless `withTakenIn` takes those too (boxes.ts dropShipmentBoxes). */
export async function deleteShipment(tx: TransactionClient, shipmentId: number, opts: { withTakenIn?: boolean } = {}): Promise<void> {
  await dropShipmentBoxes(tx, shipmentId, opts);
  await tx.shipment_items.deleteMany({ where: { shipment_id: shipmentId } });
  await tx.shipments.delete({ where: { id: shipmentId } });
}

export type ShipmentSendItem = { item_type_id?: number | null; makat?: string | null; amount?: number | null };

/** One shipment of a send and the boxes it sends. */
export type ShipmentSendLines = { shipmentId: number; items: ShipmentSendItem[] };

/**
 * The shipments a send (POST /api/shipment-history) names: `shipments: [{ shipment_id, items }]`
 * when several go out under one outgoing code, or the older single `shipment_id` + `items`.
 * Each named once, each with at least one line. In id order: each send locks its shipment
 * (recordShipmentSend), and two sends that lock in the same order never deadlock.
 */
export function readShipmentSends(body: Record<string, unknown>): ShipmentSendLines[] {
  const raw = Array.isArray(body.shipments) ? body.shipments as Record<string, unknown>[] : [{ shipment_id: body.shipment_id, items: body.items }];
  const sends = raw.map((s) => ({ shipmentId: parseDbId(s?.shipment_id), items: s?.items }));
  if (sends.length === 0 || sends.some((s) => s.shipmentId == null || !Array.isArray(s.items) || s.items.length === 0)) {
    throw new HttpError(400, "חסרים פרטי השליחה: תאריך וכמויות");
  }
  if (new Set(sends.map((s) => s.shipmentId)).size !== sends.length) throw new HttpError(400, "משלוח מופיע פעמיים בשליחה");
  return (sends as ShipmentSendLines[]).sort((a, b) => a.shipmentId - b.shipmentId);
}

export type ShipmentSendInput = ShipmentSendLines & {
  sentDate: Date;
  sender: ShipmentWorker;
  signaturePath: string | null;
};

/**
 * A send of boxes back to the customer (POST /api/shipment-history): one
 * shipment_history row per sent line (a line without a type or an amount is
 * skipped; the send popup leaves those out first), and once everything
 * declared went out the shipment closes and its pending boxes go.
 * A line may send up to what its type and makat declared less what already
 * went out (send.ts maxToSend — the popup's own limit); more is refused.
 */
export async function recordShipmentSend(tx: TransactionClient, send: ShipmentSendInput): Promise<void> {
  const { shipmentId, sentDate, sender, signaturePath } = send;
  // Locked, so two sends of one shipment count each other's boxes.
  const [shipment] = await tx.$queryRaw<{ shipment_code: string; is_sent: boolean | null }[]>`
    SELECT shipment_code, is_sent FROM shipments WHERE id = ${shipmentId} FOR UPDATE
  `;
  if (!shipment) throw new HttpError(404, "המשלוח לא נמצא");
  if (shipment.is_sent) throw new HttpError(409, `המשלוח ${shipment.shipment_code} כבר נשלח`);

  const lines = await tx.shipment_items.findMany({
    where: { shipment_id: shipmentId },
    select: { item_type_id: true, makat: true, quantity: true },
    orderBy: { id: "asc" },
  });
  const declared: DeclaredLine[] = lines.flatMap((l) => (l.item_type_id == null ? [] : [{ ...l, item_type_id: l.item_type_id }]));
  const sent: SentRow[] = await tx.shipment_history.findMany({
    where: { shipment_id: shipmentId },
    select: { item_type_id: true, makat: true, amount: true },
  });

  for (const item of send.items) {
    if (!item.item_type_id || !item.amount) continue;
    if (!Number.isInteger(item.amount) || item.amount < 0) throw new HttpError(400, "כמות מארזים לא תקינה");
    const max = maxToSend(declared, sent, item.item_type_id, item.makat);
    if (item.amount > max) {
      throw new HttpError(409, `במשלוח ${shipment.shipment_code} אפשר לשלוח עוד ${max} מארזים מהסוג הזה`, { code: "SEND_OVER_DECLARED" });
    }
    await tx.$executeRaw`
      INSERT INTO shipment_history
       (shipment_id, sending_worker_id, sending_worker_name, sent_date, item_type_id, makat, amount, signature_path)
       VALUES (${shipmentId}, ${sender.id || null}, ${sender.name || null}, ${sentDate}::timestamp, ${item.item_type_id}, ${item.makat || null}, ${item.amount}, ${signaturePath})
    `;
    sent.push({ item_type_id: item.item_type_id, makat: item.makat ?? null, amount: item.amount });
  }

  // Closed once every box declared went out — counted per type and makat, as a send is capped
  // (two lines of one type and makat share one cap, so their sum is never reached); a shipment
  // whose sends already reached its total before the cap closes too.
  const totalDeclared = lines.reduce((n, l) => n + l.quantity, 0);
  const totalSent = sent.reduce((n, r) => n + r.amount, 0);
  const nothingLeft = declared.length > 0 && remainingLines(declared, sent).length === 0;
  if (nothingLeft || (totalDeclared > 0 && totalSent >= totalDeclared)) {
    await tx.$executeRaw`UPDATE shipments SET is_sent = true, finished_at = ${sentDate}::timestamp WHERE id = ${shipmentId}`;
    await dropPendingBoxesOfSentShipment(tx, shipmentId);
  }
}
