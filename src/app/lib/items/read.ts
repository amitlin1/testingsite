import { Prisma, type item_route_history } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { boxIdOf, loadPackage } from "@/app/lib/packages/read";
import type { ItemDetailResponse, ItemListRow } from "./contract";
import { loadWorkerNames } from "./worker-names";

/**
 * The item reads of /api/items and /api/items/[id], answering the items
 * contract (./contract.ts).
 */

type ListRow = {
  item_id: bigint;
  serial_no: string | null;
  item_type_id: number;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_desc: string | null;
  current_route_step: number | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: Date | null;
  finished_at: Date | null;
  is_finished: boolean | null;
  customer_id: number;
  customer_code: string | null;
  makat: string;
  manufacturer_name: string;
  manufacturer_no: string;
  model: string;
  total_steps: number;
  shipment_id: number;
  shipment_code: string | null;
  source_id: number | null;
};

/** Every row taken in (a box waiting for intake has no route yet — lib/packages/boxes.ts), newest id first. */
export async function loadItemList(): Promise<ItemListRow[]> {
  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT i.item_id, i.serial_no, i.item_type_id, it.item_type_desc,
           ir.current_status, ist.item_status_desc, ir.current_route_step,
           ir.test_station_id, ts.test_station_desc, ir.created_at, ir.finished_at, ir.is_finished,
           i.customer_id, RTRIM(c.customer_code) AS customer_code,
           i.makat, RTRIM(i.manufacturer_name) AS manufacturer_name, i.manufacturer_no AS manufacturer_no, RTRIM(i.model) AS model,
           COALESCE(array_length(tr.route_steps, 1), 0) AS total_steps,
           i.shipment_id, sh.shipment_code, sh.source_id
    FROM items i
    LEFT JOIN item_types it ON it.item_type_id = i.item_type_id
    LEFT JOIN item_routes ir ON ir.item_id = i.item_id
    LEFT JOIN item_status ist ON ist.item_status_id = ir.current_status
    LEFT JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
    LEFT JOIN shipments sh ON sh.id = i.shipment_id
    WHERE ir.item_id IS NOT NULL
    ORDER BY i.item_id DESC
  `;
  return rows.map((row) => ({
    ...row,
    created_at: normalizeToUtcIso(row.created_at),
    finished_at: normalizeToUtcIso(row.finished_at),
    item_id: row.item_id.toString(),
    shipment_id: row.shipment_id.toString(),
    test_station_id: row.test_station_id?.toString(),
    source_id: row.source_id?.toString(),
  }));
}

/** bigint → number everywhere in the answer (15-digit ids stay exact). A Date
 *  left in it would come out as {}: every one is normalized before. */
function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)]));
  }
  return obj;
}

type DetailRow = {
  item_id: bigint;
  makat: string;
  serial_no: string | null;
  package_id: bigint | null;
  package_seq: number | null;
  is_package: boolean;
  item_type_desc: string | null;
  current_status: number | null;
  item_status_id: number | null;
  item_status_desc: string | null;
  route_steps: number[] | null;
  test_type_desc: string | null;
  current_route_step: number | null;
  test_station_id: number | null;
  test_station_desc: string | null;
  created_at: Date | null;
  finished_at: Date | null;
  is_finished: boolean | null;
  route_stations: { id: number; desc: string }[] | null;
};

type ConnectedRow = {
  item_id: bigint;
  serial_no: string | null;
  item_type_desc: string;
  current_status: number | null;
  item_status_desc: string | null;
  relation_type: "Parent" | "Child";
};

type HistoryRow = item_route_history & {
  test_station_desc: string | null;
  test_station_type_id: number | null;
  test_station_type_desc: string | null;
  /** numeric: a Decimal, NULL while the step is still open. */
  net_work_seconds: Prisma.Decimal | null;
};

/** The item, the other rows of its box, its station history (worker names
 *  from the directory) and its box's view. */
export async function loadItemDetail(itemId: bigint): Promise<ItemDetailResponse> {
  const [itemResult, connectedResult, historyResult, workerNameById] = await Promise.all([
    prisma.$queryRaw<DetailRow[]>`
      SELECT i.item_id, i.makat, i.serial_no, i.package_id, i.package_seq,
             COALESCE(it.is_package, false) AS is_package,
             it.item_type_desc,
             ir.current_status, ir.current_status AS item_status_id, s.item_status_desc,
             tr.route_steps, tst.test_type_desc,
             ir.current_route_step, ir.test_station_id, ts.test_station_desc,
             ir.created_at, ir.finished_at, ir.is_finished,
             (SELECT json_agg(json_build_object('id', u.step, 'desc', tst2.test_type_desc) ORDER BY u.ord)
                FROM (SELECT step, ord FROM unnest(tr.route_steps) WITH ORDINALITY AS u(step, ord)) u
                JOIN test_stations_type tst2 ON tst2.test_station_type_id = u.step
             ) AS route_stations
      FROM items i
      LEFT JOIN item_types it           ON it.item_type_id = i.item_type_id
      LEFT JOIN item_routes ir          ON ir.item_id = i.item_id
      LEFT JOIN item_status s           ON s.item_status_id = ir.current_status
      LEFT JOIN test_stations ts        ON ts.test_station_id = ir.test_station_id
      LEFT JOIN testing_routes tr       ON tr.item_type_id = i.item_type_id and tr.route_number = ir.route_number
      LEFT JOIN test_stations_type tst  ON tst.test_station_type_id = ANY(tr.route_steps)
      WHERE i.item_id = ${itemId}
      ORDER BY i.item_id DESC
      LIMIT 1
    `,
    prisma.$queryRaw<ConnectedRow[]>`
      SELECT i.item_id, i.serial_no, it.item_type_desc, ir.current_status, s.item_status_desc,
             CASE WHEN i.item_id = (SELECT COALESCE(package_id, item_id) FROM items WHERE item_id = ${itemId}) THEN 'Parent'
                  ELSE 'Child'
             END AS relation_type
      FROM items i
      JOIN item_types it ON i.item_type_id = it.item_type_id
      LEFT JOIN item_routes ir ON i.item_id = ir.item_id
      LEFT JOIN item_status s ON ir.current_status = s.item_status_id
      WHERE (i.package_id = (SELECT COALESCE(package_id, item_id) FROM items WHERE item_id = ${itemId})
             OR i.item_id = (SELECT COALESCE(package_id, item_id) FROM items WHERE item_id = ${itemId}))
        AND i.item_id != ${itemId}
    `,
    prisma.$queryRaw<HistoryRow[]>`
      SELECT
        h.*,
        TRIM(ts.test_station_desc) AS test_station_desc,
        ts.test_station_type_id,
        TRIM(tst.test_type_desc)  AS test_station_type_desc,
        -- Net work time of the step, on THE work clock: the same
        -- work_seconds_between() the metrics ledger uses, so the item screens
        -- and every dashboard number agree by construction. The columns are
        -- timestamp-without-zone holding UTC (§7.1), hence AT TIME ZONE 'UTC'.
        -- The IS NOT NULL guard is load-bearing: LEAST/GREATEST ignore NULLs,
        -- so work_seconds_between(start, NULL) answers 0 — a step still in
        -- progress would read "took no time".
        CASE WHEN h.processing_start_time IS NOT NULL
              AND h.processing_end_time   IS NOT NULL
             THEN work_seconds_between(h.processing_start_time AT TIME ZONE 'UTC',
                                       h.processing_end_time   AT TIME ZONE 'UTC')
        END AS net_work_seconds
      FROM item_route_history h
      LEFT JOIN test_stations ts       ON ts.test_station_id = h.test_station_id
      LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
      WHERE h.item_id = ${itemId}
      ORDER BY h.log_id DESC
      LIMIT 200
    `,
    loadWorkerNames("Item history"),
  ]);

  const row = itemResult[0];
  const item = row
    ? { ...row, connected_items: connectedResult, created_at: normalizeToUtcIso(row.created_at), finished_at: normalizeToUtcIso(row.finished_at) }
    : null;

  let packageView = null;
  const boxId = row ? boxIdOf(row) : null;
  if (boxId != null) {
    try {
      packageView = await loadPackage(boxId);
    } catch (e) {
      console.error("Error loading the item's package:", e);
    }
  }

  const history = historyResult.map((h) => ({
    ...h,
    worker_name: h.worker_id != null ? (workerNameById.get(Number(h.worker_id)) ?? null) : null,
    queue_start_time: normalizeToUtcIso(h.queue_start_time),
    processing_start_time: normalizeToUtcIso(h.processing_start_time),
    processing_end_time: normalizeToUtcIso(h.processing_end_time),
    // numeric(…) arrives as a string; NULL stays NULL (see the SQL above).
    net_work_seconds: h.net_work_seconds == null ? null : Number(h.net_work_seconds),
  }));

  return serializeBigInts({ item, history, package: packageView }) as ItemDetailResponse;
}
