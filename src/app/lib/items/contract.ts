import type { PackageView } from "@/app/lib/packages/contract";

/**
 * The items wire contract: what /api/items and /api/items/[id] answer with,
 * and the item lookups. Client-safe:
 * no prisma, no server import.
 */

/** One row of GET /api/items (the /items table). The ids the route turns into
 *  strings arrive as strings; a NULL station or source is left out. */
export type ItemListRow = {
  item_id: string;
  serial_no: string | null;
  item_type_id: number;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  test_station_id?: string;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  customer_id: number;
  customer_code: string | null;
  makat: string;
  manufacturer_name: string;
  manufacturer_no: string;
  model: string;
  total_steps: number;
  shipment_id: string;
  shipment_code: string | null;
  source_id?: string;
};

/** Another row of the item's box (or a member of the box it is): its
 *  `connected_items` on GET /api/items/[id]. */
export type ItemConnected = {
  item_id: number;
  serial_no: string | null;
  item_type_desc: string;
  current_status: number | null;
  item_status_desc: string | null;
  relation_type: "Parent" | "Child";
};

/** `item` of GET /api/items/[id]: the item with its route, status and the
 *  stations of its route. Ids are numbers (15 digits stay exact). */
export type ItemDetail = {
  item_id: number;
  makat: string;
  serial_no: string | null;
  package_id: number | null;
  package_seq: number | null;
  is_package: boolean;
  item_type_desc: string | null;
  current_status: number | null;
  /** The same value as current_status. */
  item_status_id: number | null;
  item_status_desc: string | null;
  route_steps: number[] | null;
  test_type_desc: string | null;
  current_route_step: number | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: string | null;
  finished_at: string | null;
  is_finished: boolean | null;
  /** Step i of the route: its station type, in route order (CHAR-padded desc). */
  route_stations: { id: number; desc: string }[] | null;
  connected_items: ItemConnected[];
};

/** One step of the item's history (item_route_history), newest first. */
export type ItemHistoryRow = {
  log_id: number;
  item_id: number;
  test_station_id: number;
  current_route_step: number;
  queue_start_time: string | null;
  processing_start_time: string | null;
  processing_end_time: string | null;
  worker_id: number | null;
  route_number: number;
  /** The station the step ran at, and its type. */
  test_station_desc: string | null;
  test_station_type_id: number | null;
  test_station_type_desc: string | null;
  /** Net work time of the step, from the DB's one work calendar. NULL while the
   *  step is open — "not finished" is not "took no time". */
  net_work_seconds: number | null;
  worker_name: string | null;
};

/** GET /api/items/[id]. `item` is null for an item that does not exist. */
export type ItemDetailResponse = {
  item: ItemDetail | null;
  history: ItemHistoryRow[];
  /** The item's box: its own view for a box, the parent's for an item inside
   *  one, null for a legacy loose item. */
  package?: PackageView | null;
};

/** The body of PUT /api/items/[id]: every editable field, sent whole. */
export type ItemEditBody = {
  customer: number;
  itemType: number;
  serialNumber: string;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo: string;
  /** Retyping an item of a box past its opening resets the whole box: only with this. */
  confirmPackageReset?: boolean;
};

export type ItemTypeOption = { item_type_id: number; item_type_desc: string };
export type StatusOption = { id: number; label: string };
