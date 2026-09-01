import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createItem } from "@/app/lib/create-item";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";

export const runtime = "nodejs";

/**
 * Create a single accessory (child item) under an existing parent, from the
 * intake wizard's hybrid "add missing accessory" path. The accessory is a normal
 * routed item: customer_id + shipment_id are inherited from the parent, and the
 * shared `createItem` helper generates its id, items row, and item_routes row.
 */
export async function POST(req: Request) {
  // Write-path schema gate (§8 stage 3): createItem emits item_created into
  // the metrics ledger, so refuse loudly when the DB is behind this image.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json();
    const { parentItemId, itemType, serialNumber, makat, model, manufacturer, manufacturerNo } = body;

    if (!parentItemId || !itemType || serialNumber == null || serialNumber === "" || !makat || !model || !manufacturer) {
      return NextResponse.json(
        { error: "parentItemId, itemType, serialNumber, makat, model, manufacturer are required" },
        { status: 400 },
      );
    }

    const parentBig = BigInt(parentItemId);

    const newItemId = await prisma.$transaction(async (tx) => {
      const parentRows = await tx.$queryRaw<{ customer_id: number; shipment_id: number; route_number: number | null }[]>`
        SELECT i.customer_id, i.shipment_id, ir.route_number
        FROM items i
        LEFT JOIN item_routes ir ON ir.item_id = i.item_id
        WHERE i.item_id = ${parentBig}
      `;
      if (parentRows.length === 0) throw new Error("PARENT_NOT_FOUND");
      const parent = parentRows[0];

      return createItem(
        tx,
        {
          customer: parent.customer_id,
          itemType: Number(itemType),
          serialNumber,
          makat,
          model,
          manufacturer,
          manufacturerNo: manufacturerNo ?? null,
          shipment: parent.shipment_id,
          routeNumber: parent.route_number ?? 1,
        },
        parentBig,
      );
    });

    return NextResponse.json({ ok: true, itemId: newItemId }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create accessory";
    if (message === "PARENT_NOT_FOUND") {
      return NextResponse.json({ error: "Parent item not found" }, { status: 404 });
    }
    console.error("Error creating accessory:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
