import { getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { recordTransition } from "@/app/lib/metrics/record";
import { TransactionClient } from "@/app/lib/prisma";

/**
 * Create one item (main or accessory) inside a Prisma transaction.
 *
 * Extracted from POST /api/items so the intake wizard's "add accessory" path can
 * reuse the exact same id-generation + route-assignment logic (an accessory is a
 * normal routed item with parent_item_id set). Inserts an `items` row and its own
 * `item_routes` row (status 2, step 1, station assigned via findStationForRouteStep),
 * and returns the generated numeric item id.
 */
export async function createItem(
  tx: TransactionClient,
  itemData: {
    customer: number;
    itemType: number;
    serialNumber: string | number;
    makat: string;
    model: string;
    manufacturer: string;
    manufacturerNo?: string | null;
    shipment: number;
    routeNumber?: number | null;
  },
  parentId: number | bigint | null = null,
): Promise<number> {
  const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo, shipment, routeNumber } = itemData;

  // 1. Validate customer exists (item_id is prefixed with the customer id).
  const customerRecord = await tx.customers.findUnique({
    where: { id: customer },
    select: { customer_code: true },
  });
  if (!customerRecord) throw new Error("Customer not found");

  const customerIdStr = String(customer).padStart(3, "0");

  // 2. Date part (ddMMyy) + date key for the daily counter.
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  const dateStr = `${day}${month}${year}`;
  const dateKey = `${now.getFullYear()}-${month}-${day}`;

  // 3. Atomic daily counter.
  const counterRows = await tx.$queryRaw<{ counter: number }[]>`
    INSERT INTO daily_counters (date_key, counter)
    VALUES (${dateKey}, 1)
    ON CONFLICT (date_key)
    DO UPDATE SET counter = daily_counters.counter + 1
    RETURNING counter
  `;
  const counter = counterRows[0].counter;

  // 4. Item id: [customer(3)][ddMMyy][counter] — all numeric.
  const newItemId = parseInt(`${customerIdStr}${dateStr}${counter}`, 10);
  const newItemIdBig = BigInt(newItemId);

  // 5. Insert the item.
  //
  // manufacturerNo falls back to "" and never to NULL: items.manufacturer_no is
  // NOT NULL with no default, so `manufacturerNo || null` turned a merely
  // missing field into a raw 500 (`23502`) from deep inside the transaction —
  // for the main intake route, which never even validated the field, and for
  // accessories, whose own endpoint deliberately passes it as optional. The
  // caller that REQUIRES the value validates it and answers 400 (see
  // api/items/route.ts); this write point only guarantees the column's
  // contract can't be violated by any caller.
  await tx.$executeRaw`
    INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
    VALUES (${newItemIdBig}, ${customer}, ${itemType}, ${serialNumber}, ${makat}, ${model}, ${manufacturer}, ${manufacturerNo || ""}, ${shipment}, ${parentId ? BigInt(parentId) : null})
  `;

  // 6. Route row — assign the first step's station.
  const routeNum = routeNumber || 1;
  const assignedStationId = await findStationForRouteStep(tx, itemType, routeNum, 1);
  const currentUtcDate = new Date(getCurrentUtcIso());

  await tx.$executeRaw`
    INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
    VALUES (${newItemIdBig}, ${itemType}, 2, 1, ${assignedStationId}, ${currentUtcDate}::timestamp, FALSE, ${currentUtcDate}::timestamp, ${routeNum})
  `;

  // 7. Metrics ledger, call site #1 (§4.5): item_created → queued, in the SAME
  // transaction as the item_routes INSERT — the core §4.8 guarantee. The DB
  // assigns occurred_at; metrics_record opens the route_run with a snapshot of
  // route_steps. station_type_id is the type the queued interval is waiting
  // for (feeds Q3's shared-type queue); station_id stays NULL while queued.
  const routeRow = await tx.testing_routes.findFirst({
    where: { item_type_id: itemType, route_number: routeNum },
    select: { route_steps: true },
  });
  const firstStepStationTypeId = routeRow?.route_steps?.[0] ?? null;

  await recordTransition(tx, {
    eventKey: `item_created:${newItemId}`,
    itemId: newItemIdBig,
    toState: "queued",
    stepNo: 1,
    stationTypeId: firstStepStationTypeId,
    reason: "item_created",
  });

  return newItemId;
}
