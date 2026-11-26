/**
 * The package model's wire contract — what the packages list, the package page,
 * the queue cards and the item dialog receive (read.ts builds it). Client-safe:
 * no prisma, no server import.
 *
 * Vocabulary (design/Packages.dc.html):
 *   item state   new (טרם נפתח) · queue (ממתין) · test (בבדיקה) · done (הושלם) · missing (חסר במארז)
 *   box status   pending (ממתין לקליטה) · queue (ממתין לפתיחה) · test (בבדיקה) ·
 *                waitItems (ממתין לפריטי המארז) · readyClose (ממתין לסגירה) · done (הושלם)
 */

export type PackageItemState = "new" | "queue" | "test" | "done" | "missing";
export type PackageStatusKey = "pending" | "queue" | "test" | "waitItems" | "readyClose" | "done";

export const PACKAGE_STATUS_KEYS: readonly PackageStatusKey[] = ["pending", "queue", "test", "waitItems", "readyClose", "done"];

export function isPackageStatusKey(v: unknown): v is PackageStatusKey {
  return typeof v === "string" && (PACKAGE_STATUS_KEYS as readonly string[]).includes(v);
}

export const PACKAGE_STATUS_LABEL: Record<PackageStatusKey, string> = {
  pending: "ממתין לקליטה",
  queue: "ממתין לפתיחה",
  test: "בבדיקה",
  waitItems: "ממתין לפריטי המארז",
  readyClose: "ממתין לסגירה",
  done: "הושלם",
};

export const ITEM_STATE_LABEL: Record<PackageItemState, string> = {
  new: "טרם נפתח",
  queue: "ממתין",
  test: "בבדיקה",
  done: "הושלם",
  missing: "חסר במארז",
};

export type PackageItemView = {
  item_id: string;
  package_seq: number | null;
  item_type_id: number;
  item_type_desc: string;
  serial_no: string | null;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  current_status: number | null;
  current_route_step: number | null;
  route_length: number;
  /** Station type of the item's current route step ("כיול RF"), raw. */
  step_desc: string | null;
  is_finished: boolean;
  state: PackageItemState;
  state_label: string;
  /** Where the item is right now, in words: a station, "ממתין ל<type>", "ממתין למחקר"; null when
   *  it is done (rules.ts itemWhereText). */
  station_name: string | null;
  /** True when the item is at the package's closing step (waiting or in test). */
  arrived_at_closing: boolean;
  /** The station type of the step before the current one — where "חזרה לבדיקה
   *  הקודמת" sends the item; null at step 1. */
  prev_step_desc: string | null;
  /** That step is package-level (the box's opening): an item can't go back to it. */
  prev_step_package_level: boolean;
  /** A closed box's item whose report waits: "external" — it came out "לא תקין" and waits for an
   *  external approval; "sign" — for the approver's final signature; null otherwise. */
  report_waits: "external" | "sign" | null;
  /** Closing decision recorded on the box for this item, when any. */
  pack_decision: "packed" | "packed_anyway" | "missing" | null;
  pack_note: string | null;
};

export type PackageView = {
  item_id: string;
  item_type_id: number;
  item_type_desc: string;
  customer_id: number;
  customer_code: string | null;
  customer_name: string | null;
  shipment_id: number;
  shipment_code: string | null;
  makat: string | null;
  model: string | null;
  manufacturer_name: string | null;
  manufacturer_no: string | null;
  route_number: number | null;
  current_status: number | null;
  current_route_step: number | null;
  /** Station type of the box's current step (the queue it belongs to). */
  current_step_type_id: number | null;
  /** Station type of the box's current step, in words. */
  current_step_desc: string | null;
  /** The station the box is being worked at right now, when in test. */
  station_name: string | null;
  route_length: number;
  is_finished: boolean;
  /** The box left with its shipment (shipments.is_sent): history only. */
  shipment_is_sent: boolean;
  shipment_sent_at: string | null;
  created_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  status: PackageStatusKey;
  status_label: string;
  items: PackageItemView[];
  finished_count: number;
  /** A closed box: how many of its items' reports wait for the approver's final signature
   *  (item-report "awaiting_signature"). 0 on a box not closed yet. */
  awaiting_final_signature: number;
  /** Of those, how many came out "לא תקין" — an external approver may pass them (the list's
   *  "ממתינים לאישור גורם חיצוני"). */
  awaiting_external_approval: number;
  /** Items that keep the box out of the closing queue, with where they are. */
  blocked_by: { item_id: string; package_seq: number | null; item_type_desc: string; station_name: string | null }[];
  template_snapshot: unknown;
  /** The box label scanned at the opening station (its step-1 result); the
   *  closing wizard starts from it. Null until opened. */
  opening_sku: string | null;
  /** The shipment line the box was minted for (items.shipment_item_id), and
   *  that line's certificate row: its number and serial. A line typed by hand
   *  has neither; a box from before boxes were linked has no line. */
  shipment_item_id: number | null;
  cert_row_no: string | null;
  cert_serial_no: string | null;
};

export type PackageTimelineEntry = {
  key: "intake" | "open" | "close";
  title: string;
  at: string | null;
  worker_id: number | null;
  state: "done" | "pending" | "blocked" | "queued";
  note: string | null;
};

/* Pure rules over the view, shared by the server's list filter and the screens. */

const hasText = (s: string | null | undefined, q: string) => (s ?? "").toLowerCase().includes(q);
const searchKey = (q: string) => q.trim().toLowerCase();

/** An item answers a search by its id, serial or makat. */
export function itemMatches(it: Pick<PackageItemView, "item_id" | "serial_no" | "makat">, q: string): boolean {
  const k = searchKey(q);
  return it.item_id.includes(k) || hasText(it.serial_no, k) || hasText(it.makat, k);
}

/** A box answers a search by its own id, type, makat, shipment code or customer name. */
export function packageOwnMatches(
  v: Pick<PackageView, "item_id" | "item_type_desc" | "makat" | "shipment_code" | "customer_name">,
  q: string,
): boolean {
  const k = searchKey(q);
  return v.item_id.includes(k) || hasText(v.item_type_desc, k) || hasText(v.makat, k) || hasText(v.shipment_code, k) || hasText(v.customer_name, k);
}

/** A box answers a search by its own fields or one of its items'. */
export function packageMatches(v: PackageView, q: string): boolean {
  return packageOwnMatches(v, q) || v.items.some((it) => itemMatches(it, q));
}

/** The box is still at its opening station: items may be added to it there. */
export function isAtOpening(v: Pick<PackageView, "current_route_step" | "is_finished" | "status">): boolean {
  return (v.current_route_step ?? 1) <= 1 && !v.is_finished && (v.status === "queue" || v.status === "test");
}

/** The box waits at its closing step for items still elsewhere (listed in blocked_by). */
export function waitsForItems(v: Pick<PackageView, "status" | "blocked_by">): boolean {
  return v.status === "waitItems" && v.blocked_by.length > 0;
}
