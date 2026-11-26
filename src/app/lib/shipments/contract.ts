/**
 * The shipments wire contract: a shipment as /api/shipments answers it, the
 * body the shipment form saves, and the customer lookup row (/api/customers).
 * Client-safe: no prisma, no server import.
 */

/** A shipment line's makat and the whole certificate row it was scanned from
 *  (lib/itemQrParser.ts); its boxes are minted with makat / model /
 *  manufacturer (lib/packages/boxes.ts). NULL on a line typed by hand. */
export type ShipmentLineDetails = {
  makat?: string | null;
  model?: string | null;
  manufacturer_name?: string | null;
  manufacturer_no?: string | null;
  /** מס"ד — the row's number on the certificate. */
  cert_row_no?: string | null;
  serial_no?: string | null;
  /** גודל אצווה, as printed. */
  batch_size?: string | null;
  qty_to_test?: number | null;
  purchase_order?: string | null;
  /** The row exactly as in the barcode. */
  cert_row_raw?: string | null;
};

export type Shipment = {
  id: number;
  shipment_code: string;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  shipment_date: string;
  makat: string | null; // Legacy
  amount: number;
  total_items: number;
  in_work_items: number;
  valid_items: number;
  recieving_worker_id: number | null;
  recieving_worker_name: string | null;
  item_type_id: number | null; // Legacy
  item_type_desc: string | null; // Legacy
  signature_path?: string | null;
  /** `id` is the line's shipment_items row: an edit sends it back as `line_id`
   *  so the line keeps its boxes (lib/packages/boxes.ts). */
  shipment_items?: ({ id?: number; item_type_id: number; quantity: number; item_type_desc?: string } & ShipmentLineDetails)[];
  source_id: number | null;
  source_desc: string | null;
  sending_worker_id: number | null;
  sending_worker_name: string | null;
  shipment_sent_date: string | null;
  is_sent?: boolean;
  finished_at?: string | null;
  /** Package model (docs/features/packages/PLAN.md §9.10): the counters below count
   *  BOXES of this shipment — declared (amount) / taken in (sampled) /
   *  started / finished / sent. */
  sampled_amount?: number;
  valid_amount?: number;
  finished_sampled_amount?: number;
  started_sampled_amount?: number;
  sent_amount?: number;
  poc_details?: string | null;
  /** When the shipment was entered into the system (shipments.received_at);
   *  null on shipments saved before it was recorded. shipment_date is the
   *  certificate's date. */
  received_at?: string | null;
};

export type NewShipment = {
  shipment_code: string;
  customer_id: number | null;
  shipment_date: Date | null;
  makat: string | null; // Legacy main makat
  amount: number | null;
  recieving_worker_id?: number | null;
  recieving_worker_name?: string | null;
  /** `line_id`: the saved line this one edits (none on a new line). */
  shipment_items?: ({ line_id?: number | null; item_type_id: number; quantity: number } & ShipmentLineDetails)[];
  source_id?: number | null;
  sending_worker_id: number | null;
  sending_worker_name?: string | null;
  poc_details?: string | null;
};

export type Customers = { id: number; name: string; customer_code: string };

/** shipments.shipment_code is VARCHAR(20). */
export const SHIPMENT_CODE_MAX = 20;

/** POC details are English only. The server refuses only Hebrew letters; the
 *  form is stricter: the certificate tool (shipment-QR_CODE-) lets English
 *  letters, digits and contact punctuation into the POC, so everything it can
 *  put in the barcode passes the form too. */
export const POC_HAS_HEBREW = /[֐-׿]/;
export const POC_FORM_ALLOWED = /^[A-Za-z0-9\s.,!?'()/@&+-]*$/;

/** A certificate's shipment number as two shipments are compared by: trimmed, case-blind. */
export const certificateNumber = (code: string | null | undefined): string => (code ?? "").trim().toUpperCase();

/** The same certificate = the same shipment number (certificateNumber) and
 *  the same customer: the key the form and the server's SHIPMENT_DUPLICATE
 *  refusal both compare. */
export function duplicateKey(code: string | null | undefined, customerId: number | null | undefined): string {
  return `${certificateNumber(code)}|${customerId ?? ""}`;
}

/** The refusal codes a shipment form acts on (the rest it only shows). */
export const SHIPMENT_DUPLICATE = "SHIPMENT_DUPLICATE";

/** The shipment a duplicate repeats: what SHIPMENT_DUPLICATE carries in `existing`. */
export type DuplicateShipment = {
  id: number;
  shipment_code: string;
  customer_code: string | null;
  shipment_date: string | null;
  received_at: string | null;
  amount: number;
};

/** What a shipment save did to its boxes (also a PUT dry_run's answer). */
export type BoxSync = {
  /** Boxes minted. */
  created: number;
  /** Pending boxes deleted: their labels no longer scan. */
  removed: string[];
  /** Pending boxes minted again under the shipment's new customer (the id
   *  holds the customer): their labels are printed again. */
  reminted: number;
};

/** One send of a shipment (shipment_history), as /api/shipment-history/[id] answers it. */
export type ShipmentSend = {
  log_id: number;
  shipment_id: number;
  sent_shipment_code: string;
  sent_date: string;
  sending_worker_id: number | null;
  sending_worker_name: string | null;
  item_type_id: number | null;
  item_type_desc: string | null;
  makat: string | null;
  amount: number;
  signature_path: string | null;
};

/** What already went out of a shipment, per package type and makat, as
 *  /api/shipment-history?shipment_id answers it. */
export type ShipmentSentTotal = { item_type_id: number | null; makat: string | null; total_sent: number };

/** Where a stored signature of the shipment is served (api/shipments/[id]/files/[filename]). */
export function signatureUrl(shipmentId: number | string, path: string): string {
  return `/api/shipments/${shipmentId}/files/${path}`;
}
