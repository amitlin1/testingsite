import { prisma } from "@/app/lib/prisma";
import { NextResponse } from "next/server";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { createItem } from "@/app/lib/create-item";

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
    i.customer_id,
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

    // Item + accessory creation lives in the shared createItem helper (also used
    // by the intake wizard's "add accessory" endpoint).
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
