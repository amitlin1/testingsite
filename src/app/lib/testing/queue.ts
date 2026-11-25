import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ItemStatus } from "@/lib/item-status";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { boxIdOf, loadPackages } from "@/app/lib/packages/read";
import type { PackageView } from "@/app/lib/packages/contract";
import type { QueueRow } from "./contract";
import { listedAtStation } from "./queue-rule";

/** One row of the queue query: the item's route, the item, and the names around them. */
type QueueDbRow = {
  item_id: bigint;
  item_type_id: number;
  current_status: number;
  current_route_step: number;
  test_station_id: number | null;
  created_at: Date;
  processing_start_time: Date | null;
  queue_start_time: Date;
  finished_at: Date | null;
  is_finished: boolean;
  item_status_desc: string;
  route_steps: number[];
  serial_no: string | null;
  makat: string;
  model: string;
  customer_code: string | null;
  manufacturer_name: string;
  manufacturer_no: string;
  item_type_desc: string | null;
  is_package: boolean | null;
  customer_name: string | null;
  customer_id: number;
  shipment_id: number;
  shipment_code: string | null;
  route_number: number;
  package_id: bigint | null;
  package_seq: number | null;
  parent_serial_no: string | null;
  last_sku: string | null;
  has_children: boolean;
  /** json_agg: the item's box mates (or its own members); ids as JSON numbers. */
  connected_items: { item_id: number; serial_no: string | null }[] | null;
};

/** A queue row as GET /api/testing/items sends it. `parent_serial_no`, `has_children` and
 *  `connected_items` are on the wire although no testing client reads them. */
export type QueueAnswerRow = QueueRow & {
  parent_serial_no: string | null;
  has_children: boolean;
  connected_items?: { item_id: number | null; serial_no: string | null }[];
};

/** The station's queue (the queue rule, queue-rule.ts): in test first, then the newest first. Every
 *  row carries its box's view — a box row its own, an item inside a box its parent's. */
export async function listQueue(stationId: number): Promise<QueueAnswerRow[]> {
  const rows = await prisma.$queryRaw<QueueDbRow[]>`
    WITH selected_station AS (
      SELECT
          st.test_station_type_id,
          st.is_research,
          COALESCE(stt.package_level, false) AS package_level
      FROM test_stations st
      LEFT JOIN test_stations_type stt
          ON stt.test_station_type_id = st.test_station_type_id
      WHERE st.test_station_id = ${stationId}
    )
    SELECT
        t1.item_id,
        t1.item_type_id,
        t1.current_status,
        t1.current_route_step,
        t1.test_station_id,
        t1.created_at,
        t1.processing_start_time,
        t1.queue_start_time,
        t1.finished_at,
        t1.is_finished,
        t3.item_status_desc,
        t2.route_steps,
        i.serial_no,
        i.makat,
        i.model,
        TRIM(c.customer_code) AS "customer_code",
        i.manufacturer_name,
        i.manufacturer_no,
        TRIM(it.item_type_desc) AS "item_type_desc",
        it.is_package AS "is_package",
        TRIM(c.name) AS "customer_name",
        i.customer_id,
        i.shipment_id,
        sh.shipment_code,
        t1.route_number,
        i.package_id,
        i.package_seq,
        (SELECT parent.serial_no FROM items parent WHERE parent.item_id = i.package_id) AS "parent_serial_no",
        -- The manufacturer SKU the item was last scanned with (the first step of every station;
        -- its reference item is found by it): the next station's scan starts from it.
        (
            SELECT NULLIF(TRIM(tr.details->>'sku'), '')
            FROM test_results tr
            WHERE tr.item_id = i.item_id AND NULLIF(TRIM(tr.details->>'sku'), '') IS NOT NULL
            ORDER BY tr.created_at DESC, tr.test_result_id DESC
            LIMIT 1
        ) AS "last_sku",
        (EXISTS (SELECT 1 FROM items child WHERE child.package_id = i.item_id)) AS "has_children",
        (
            SELECT json_agg(json_build_object(
                'item_id', connected.item_id,
                'serial_no', connected.serial_no
            ))
            FROM items connected
            WHERE
                (
                    (i.package_id IS NOT NULL AND (connected.package_id = i.package_id OR connected.item_id = i.package_id))
                    OR
                    (i.package_id IS NULL AND connected.package_id = i.item_id)
                )
                AND connected.item_id != i.item_id
        ) AS "connected_items"
    FROM item_routes t1
    INNER JOIN items i
        ON i.item_id = t1.item_id
    LEFT JOIN customers c
        ON c.id = i.customer_id
    LEFT JOIN shipments sh
        ON sh.id = i.shipment_id
    JOIN testing_routes t2
        ON t1.item_type_id = t2.item_type_id
       AND t1.route_number = t2.route_number
    JOIN item_status t3
        ON t1.current_status = t3.item_status_id
    LEFT JOIN item_types it
        ON it.item_type_id = i.item_type_id
    CROSS JOIN selected_station ss
    WHERE ${listedAtStation({
      route: "t1",
      item: "i",
      stationId: Prisma.sql`${stationId}`,
      stationTypeId: Prisma.sql`ss.test_station_type_id`,
      stationIsResearch: Prisma.sql`ss.is_research`,
      stationPackageLevel: Prisma.sql`ss.package_level`,
      currentStepTypeId: Prisma.sql`t2.route_steps[t1.current_route_step]`,
    })}
    ORDER BY
        CASE WHEN t1.current_status = ${ItemStatus.InTest} THEN 0 ELSE 1 END,
        t1.created_at DESC
  `;

  const boxOf = new Map(rows.map((row) => [row, boxIdOf({ item_id: row.item_id, package_id: row.package_id, is_package: row.is_package === true })]));
  const boxIds = [...new Set([...boxOf.values()].filter((id): id is bigint => id != null).map(String))];
  const views = boxIds.length > 0 ? await loadPackages({ ids: boxIds.map((id) => BigInt(id)) }) : [];
  const viewById = new Map<string, PackageView>(views.map((v) => [v.item_id, v]));

  return rows.map((row) => {
    const boxId = boxOf.get(row);
    return {
      ...row,
      item_id: Number(row.item_id),
      test_station_id: row.test_station_id != null ? Number(row.test_station_id) : null,
      package_id: row.package_id != null ? Number(row.package_id) : null,
      created_at: normalizeToUtcIso(row.created_at),
      processing_start_time: normalizeToUtcIso(row.processing_start_time),
      queue_start_time: normalizeToUtcIso(row.queue_start_time),
      finished_at: normalizeToUtcIso(row.finished_at),
      route_steps: row.route_steps ?? [],
      connected_items: row.connected_items?.map((ci) => ({
        ...ci,
        item_id: ci.item_id != null ? Number(ci.item_id) : null,
      })),
      package: boxId != null ? (viewById.get(String(boxId)) ?? null) : null,
      is_package: row.is_package === true && row.package_id == null,
    };
  });
}
