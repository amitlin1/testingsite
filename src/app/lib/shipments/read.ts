import type { shipments } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ItemStatus } from "@/lib/item-status";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { signatureUrl, type ShipmentSend } from "./contract";

/** The shipments reads: the shipments table (GET /api/shipments) and a shipment's sends (shipment-history). */

/** One shipment line as the list query builds it (json_build_object below). */
type ShipmentLineJson = {
  id: number;
  item_type_id: number | null;
  quantity: number;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  cert_row_no: string | null;
  serial_no: string | null;
  batch_size: string | null;
  qty_to_test: number | null;
  purchase_order: string | null;
  cert_row_raw: string | null;
  item_type_desc: string | null;
};

type ShipmentListRow = Pick<
  shipments,
  | "id" | "shipment_code" | "customer_id" | "shipment_date" | "amount" | "makat" | "signature_path"
  | "received_at" | "recieving_worker_id" | "recieving_worker_name" | "source_id" | "sending_worker_id"
  | "sending_worker_name" | "poc_details" | "shipment_sent_date" | "is_sent" | "finished_at"
> & {
  customer_code: string;
  customer_name: string;
  item_type_id: number | null;
  item_type_desc: string | null;
  source_desc: string | null;
  total_items: number;
  in_work_items: number;
  valid_items: number;
  sampled_amount: number;
  valid_amount: number;
  finished_sampled_amount: number;
  started_sampled_amount: number;
  sent_amount: number;
  shipment_items: ShipmentLineJson[] | null;
};

/**
 * Every shipment with its lines and its box counters. Package model
 * (docs/packages/PLAN.md §9.10, §9.13): a shipment declares package types and
 * counts, so every counter counts BOXES (items.is_package, never the items
 * inside them):
 *   sampled  = boxes taken in for this shipment
 *   started  = boxes that left the untouched state (opened / in test /
 *              waiting for items / finished)
 *   finished = boxes that closed (route finished)
 *   sent     = boxes returned to the customer (shipment_history)
 * in_work_items, valid_items and valid_amount have no reader left; the
 * response keeps them.
 */
export async function loadShipments() {
  const rows = await prisma.$queryRaw<ShipmentListRow[]>`
    WITH shipment_counts AS (
      SELECT
        i.shipment_id,
        COUNT(*)::int AS total_items,
        COUNT(*) FILTER (WHERE ir.item_id IS NOT NULL)::int AS sampled_amount,
        COUNT(*) FILTER (WHERE ir.current_status IN (${ItemStatus.InTest}, ${ItemStatus.InResearch}))::int AS in_work_items,
        COUNT(*) FILTER (WHERE ir.current_status = ${ItemStatus.Done} OR ir.is_finished = true)::int AS valid_items,
        COUNT(*) FILTER (WHERE ir.is_finished = true)::int AS valid_amount,
        COUNT(*) FILTER (WHERE ir.current_status = ${ItemStatus.Done} OR ir.is_finished = true)::int AS finished_sampled_amount,
        COUNT(*) FILTER (
          WHERE ir.item_id IS NOT NULL
            AND (ir.current_status <> ${ItemStatus.Queued} OR ir.current_route_step > 1 OR ir.is_finished = true)
        )::int AS started_sampled_amount
      FROM items i
      JOIN item_types it ON it.item_type_id = i.item_type_id
      LEFT JOIN item_routes ir ON ir.item_id = i.item_id
      WHERE COALESCE(it.is_package, false) = true AND i.package_id IS NULL
      GROUP BY i.shipment_id
    ),
    sent_counts AS (
      SELECT shipment_id, COALESCE(SUM(amount), 0)::int AS sent_amount
      FROM shipment_history
      GROUP BY shipment_id
    )
    SELECT
      s.id, s.shipment_code, s.customer_id, c.customer_code, c.name as customer_name,
      s.shipment_date, s.amount, s.makat, s.signature_path, s.received_at,
      s.recieving_worker_id, s.recieving_worker_name,
      (SELECT si.item_type_id FROM shipment_items si WHERE si.shipment_id = s.id LIMIT 1) as item_type_id,
      (SELECT sit.item_type_desc FROM shipment_items si JOIN item_types sit ON si.item_type_id = sit.item_type_id WHERE si.shipment_id = s.id LIMIT 1) as item_type_desc,
      s.source_id, src.source_desc, s.sending_worker_id, s.sending_worker_name, s.poc_details,
      s.shipment_sent_date, s.is_sent, s.finished_at,
      COALESCE(sc.total_items, 0) as total_items,
      COALESCE(sc.in_work_items, 0) as in_work_items,
      COALESCE(sc.valid_items, 0) as valid_items,
      COALESCE(sc.sampled_amount, 0) as sampled_amount,
      COALESCE(sc.valid_amount, 0) as valid_amount,
      COALESCE(sc.finished_sampled_amount, 0) as finished_sampled_amount,
      COALESCE(sc.started_sampled_amount, 0) as started_sampled_amount,
      COALESCE(snt.sent_amount, 0) as sent_amount,
      (
          SELECT json_agg(json_build_object(
              'id', si.id,
              'item_type_id', si.item_type_id,
              'quantity', si.quantity,
              'makat', si.makat,
              'model', si.model,
              'manufacturer_name', si.manufacturer_name,
              'manufacturer_no', si.manufacturer_no,
              'cert_row_no', si.cert_row_no,
              'serial_no', si.serial_no,
              'batch_size', si.batch_size,
              'qty_to_test', si.qty_to_test,
              'purchase_order', si.purchase_order,
              'cert_row_raw', si.cert_row_raw,
              'item_type_desc', sit.item_type_desc
          ) ORDER BY si.id) -- the order the lines were entered: a line edited in place moves on disk, not here
          FROM shipment_items si
          JOIN item_types sit ON si.item_type_id = sit.item_type_id
          WHERE si.shipment_id = s.id
      ) as shipment_items
    FROM shipments s
    JOIN customers c ON s.customer_id = c.id
    LEFT JOIN sources src ON s.source_id = src.source_id
    LEFT JOIN shipment_counts sc ON sc.shipment_id = s.id
    LEFT JOIN sent_counts snt ON snt.shipment_id = s.id
    ORDER BY s.shipment_date DESC
  `;
  return rows.map((row) => ({
    ...row,
    shipment_date: normalizeToUtcIso(row.shipment_date),
    // timestamptz: already an instant, no zone guessing.
    received_at: row.received_at ? new Date(row.received_at).toISOString() : null,
    shipment_sent_date: normalizeToUtcIso(row.shipment_sent_date),
    finished_at: normalizeToUtcIso(row.finished_at),
    signature_path: row.signature_path ? signatureUrl(row.id, row.signature_path) : null,
  }));
}

/** A shipment's sends, newest first, each signature as its URL. */
export async function loadShipmentSends(shipmentId: number): Promise<ShipmentSend[]> {
  const rows = await prisma.$queryRaw<(Omit<ShipmentSend, "sent_date"> & { sent_date: Date })[]>`
    SELECT sh.log_id, sh.shipment_id, sh.sent_shipment_code, sh.sent_date, sh.sending_worker_id, sh.sending_worker_name,
           sh.item_type_id, it.item_type_desc, sh.makat, sh.amount, sh.signature_path
    FROM shipment_history sh
    LEFT JOIN item_types it ON sh.item_type_id = it.item_type_id
    WHERE sh.shipment_id = ${shipmentId}
    ORDER BY sh.sent_date DESC, sh.log_id DESC
  `;
  return rows.map((row) => ({
    ...row,
    signature_path: row.signature_path ? signatureUrl(shipmentId, row.signature_path) : null,
  })) as unknown as ShipmentSend[];
}

/** How many boxes of each type and makat a shipment already sent. */
export function loadSentTotals(shipmentId: number) {
  return prisma.$queryRaw<{ item_type_id: number | null; makat: string | null; total_sent: number }[]>`
    SELECT item_type_id, makat, SUM(amount)::int as total_sent
    FROM shipment_history
    WHERE shipment_id = ${shipmentId}
    GROUP BY item_type_id, makat
  `;
}
