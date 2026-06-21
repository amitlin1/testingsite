import { prisma } from "@/app/lib/prisma";
import { NextResponse } from "next/server";
import { normalizeToUtcIso, getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { TransactionClient } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
    i.item_id,
    i.serial_no,
    i.item_type_id,
    it.item_type_desc,
    ir.current_status,
    ist.item_status_desc,
    ir.current_route_step,
    ir.test_station_id,
    ts.test_station_desc,
    ir.created_at,
    ir.finished_at,
    ir.is_finished,
    RTRIM(c.customer_code) AS customer_code,
    i.makat,
    RTRIM(i.manufacturer_name) AS manufacturer_name,
    i.manufacturer_no AS manufacturer_no,
    RTRIM(i.model) AS model,
    COALESCE(array_length(tr.route_steps, 1), 0) as total_steps,
    i.shipment_id,
    sh.shipment_code,
    sh.source_id
FROM items i
LEFT JOIN item_types it ON it.item_type_id = i.item_type_id
LEFT JOIN item_routes ir ON ir.item_id = i.item_id
LEFT JOIN item_status ist ON ist.item_status_id = ir.current_status
LEFT JOIN test_stations ts ON ts.test_station_id = ir.test_station_id
LEFT JOIN customers c ON c.id = i.customer_id
LEFT JOIN testing_routes tr ON tr.item_type_id = i.item_type_id AND tr.route_number = ir.route_number
LEFT JOIN shipments sh ON sh.id = i.shipment_id
ORDER BY i.item_id DESC
    `;

    // Normalize all timestamp fields to UTC ISO strings and handle BigInt
    const normalizedRows = rows.map((row: any) => ({
      ...row,
      created_at: normalizeToUtcIso(row.created_at),
      finished_at: normalizeToUtcIso(row.finished_at),
      // specific BigInt fields if known, or generic replacer
      item_id: row.item_id?.toString(),
      shipment_id: row.shipment_id?.toString(),
      test_station_id: row.test_station_id?.toString(),
      source_id: row.source_id?.toString(),
    }));

    // Use a custom stringify to handle any remaining BigInts safely
    const json = JSON.stringify(normalizedRows, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    );

    return new NextResponse(json, { 
        headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error("Error loading items:", error);
    return NextResponse.json([]);
  }
}


export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log(body)
    const { customer, itemType, serialNumber, makat, model, manufacturer, shipment, subItems } = body;
    console.log("shipment", shipment)

    // Validate required fields for main item
    if (!customer || !itemType || serialNumber === null || serialNumber === undefined || !makat || !model || !manufacturer || !shipment) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Helper to create an item inside a Prisma transaction
    const createItem = async (tx: TransactionClient, itemData: any, parentId: number | null = null) => {
      const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo, shipment, routeNumber } = itemData;

      // 1. Get customer code (validate customer exists)
      const customerRecord = await tx.customers.findUnique({
        where: { id: customer },
        select: { customer_code: true },
      });
      if (!customerRecord) throw new Error("Customer not found");

      // Use customer ID (numeric) for item_id generation
      const customerId = customer;
      const customerIdStr = String(customerId).padStart(3, '0');

      // 2. Generate date part (ddMMyy)
      const now = new Date();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = String(now.getFullYear()).slice(-2);
      const dateStr = `${day}${month}${year}`;
      const dateKey = `${now.getFullYear()}-${month}-${day}`;

      // 3. Get and increment daily counter (atomic within transaction)
      const counterRows = await tx.$queryRaw<any[]>`
        INSERT INTO daily_counters (date_key, counter)
        VALUES (${dateKey}, 1)
        ON CONFLICT (date_key)
        DO UPDATE SET counter = daily_counters.counter + 1
        RETURNING counter
      `;

      const counter = counterRows[0].counter;

      // 4. Construct Item ID: [customer_id_padded][ddMMyy][counter] - ALL NUMERIC
      const newItemId = parseInt(`${customerIdStr}${dateStr}${counter}`, 10);
      const newItemIdBig = BigInt(newItemId);

      // 5. Insert Item
      await tx.$executeRaw`
        INSERT INTO items (item_id, customer_id, item_type_id, serial_no, makat, model, manufacturer_name, manufacturer_no, shipment_id, parent_item_id)
        VALUES (${newItemIdBig}, ${customer}, ${itemType}, ${serialNumber}, ${makat}, ${model}, ${manufacturer}, ${manufacturerNo || null}, ${shipment}, ${parentId ? BigInt(parentId) : null})
      `;

      // Route logic - find best station for first route step
      const routeNum = routeNumber || 1;
      const assignedStationId = await findStationForRouteStep(tx, itemType, routeNum, 1);

      // Use the same UTC timestamp format as start-test API for consistency
      const currentUtcIso = getCurrentUtcIso();
      const currentUtcDate = new Date(currentUtcIso);

      await tx.$executeRaw`
        INSERT INTO item_routes (item_id, item_type_id, current_status, current_route_step, test_station_id, created_at, is_finished, queue_start_time, route_number)
        VALUES (${newItemIdBig}, ${itemType}, 2, 1, ${assignedStationId}, ${currentUtcDate}::timestamp, FALSE, ${currentUtcDate}::timestamp, ${routeNum})
      `;

      return newItemId;
    };

    let mainItemId: number;

    mainItemId = await prisma.$transaction(async (tx) => {
      // Create Main Item
      const mainId = await createItem(tx, body, null);

      // Create Sub Items
      if (Array.isArray(subItems) && subItems.length > 0) {
        for (const sub of subItems) {
          await createItem(tx, sub, mainId);
        }
      }

      return mainId;
    });

    return NextResponse.json({ ok: true, itemId: mainItemId }, { status: 201 });
  } catch (error: any) {
    console.error("Error creating item:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create item" },
      { status: 500 }
    );
  }
}
