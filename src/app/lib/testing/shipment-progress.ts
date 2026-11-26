import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import type { ShipmentProgress } from "./contract";

type ProgressDbRow = {
  shipment_id: number;
  shipment_code: string | null;
  received_at: Date | null;
  shipment_date: Date | null;
  total: bigint;
  done: bigint;
};

/**
 * The testing screen's tree, per shipment: of the shipment's rows that pass this station's type,
 * how many are already past it. Counted from where each row stands now (not from history), so a
 * step back or a retype puts an item back among the not-done ones.
 *
 * Which rows count follows the queue rule's level (queue-rule.ts): an opening / closing station
 * counts the boxes (rows outside a box), any other station the items (not the box rows).
 */
export async function shipmentProgress(stationId: number, shipmentIds: readonly number[]): Promise<ShipmentProgress[]> {
  if (shipmentIds.length === 0) return [];
  const rows = await prisma.$queryRaw<ProgressDbRow[]>`
    WITH ss AS (
      SELECT st.test_station_type_id AS type_id, COALESCE(stt.package_level, false) AS package_level
      FROM test_stations st
      LEFT JOIN test_stations_type stt ON stt.test_station_type_id = st.test_station_type_id
      WHERE st.test_station_id = ${stationId}
    ),
    passing AS (
      SELECT
        i.shipment_id,
        (r.is_finished OR r.finished_at IS NOT NULL
          OR r.current_route_step > (SELECT max(p) FROM unnest(array_positions(tr.route_steps, ss.type_id)) AS p)) AS is_done
      FROM items i
      JOIN item_routes r ON r.item_id = i.item_id
      JOIN testing_routes tr ON tr.item_type_id = r.item_type_id AND tr.route_number = r.route_number
      LEFT JOIN item_types it ON it.item_type_id = i.item_type_id
      CROSS JOIN ss
      WHERE i.shipment_id IN (${Prisma.join(shipmentIds)})
        AND ss.type_id = ANY(tr.route_steps)
        AND CASE WHEN ss.package_level
                 THEN i.package_id IS NULL
                 ELSE NOT (COALESCE(it.is_package, false) AND i.package_id IS NULL)
            END
    )
    SELECT
      sh.id AS shipment_id,
      sh.shipment_code,
      sh.received_at,
      sh.shipment_date,
      COUNT(p.shipment_id) AS total,
      COUNT(p.shipment_id) FILTER (WHERE p.is_done) AS done
    FROM shipments sh
    LEFT JOIN passing p ON p.shipment_id = sh.id
    WHERE sh.id IN (${Prisma.join(shipmentIds)})
    GROUP BY sh.id, sh.shipment_code, sh.received_at, sh.shipment_date
  `;
  return rows.map((r) => ({
    shipmentId: Number(r.shipment_id),
    shipmentCode: r.shipment_code?.trim() || null,
    receivedAt: normalizeToUtcIso(r.received_at ?? r.shipment_date),
    total: Number(r.total),
    done: Number(r.done),
  }));
}
