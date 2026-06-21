import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { getCurrentUtcIso } from "@/app/lib/datetime";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const { statusId } = await req.json();

    const currentUtcIso = getCurrentUtcIso();
    const currentUtcDate = new Date(currentUtcIso);
    const itemIdBig = BigInt(itemId);

    // Check if item_routes exists
    const existingRoute = await prisma.item_routes.findFirst({
      where: { item_id: itemIdBig },
    });

    if (!existingRoute) {
      // Get item_type_id from items
      const item = await prisma.items.findUnique({
        where: { item_id: itemIdBig },
        select: { item_type_id: true },
      });

      const itemTypeId = item?.item_type_id ?? 1;

      await prisma.item_routes.create({
        data: {
          item_id: itemIdBig,
          item_type_id: itemTypeId,
          current_status: statusId,
          current_route_step: 1,
          test_station_id: null,
          created_at: currentUtcDate,
          is_finished: false,
          queue_start_time: currentUtcDate,
        },
      });
    } else {
      await prisma.$executeRaw`
        UPDATE item_routes
        SET current_status = ${statusId}
        WHERE item_id = ${itemIdBig}
      `;
    }

    // Log in history
    await prisma.$executeRaw`
      INSERT INTO item_route_history (item_id, test_station_id, current_route_step, processing_end_time, route_number)
      SELECT ir.item_id, COALESCE(ir.test_station_id, 0), COALESCE(ir.current_route_step, 1), ${currentUtcDate}::timestamp, COALESCE(ir.route_number, 1)
      FROM item_routes ir WHERE ir.item_id = ${itemIdBig}
    `;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating item status:", error);
    return NextResponse.json(
      { error: "Failed to update item status" },
      { status: 500 }
    );
  }
}
