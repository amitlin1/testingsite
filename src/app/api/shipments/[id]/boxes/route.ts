import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { syncShipmentBoxes } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { mintOrderKey } from "@/app/lib/packages/ids";
import { loadPackages } from "@/app/lib/packages/read";
import { SHIPMENT_TX } from "@/app/lib/shipments/lines";

export const runtime = "nodejs";

/**
 * POST /api/shipments/[id]/boxes — the shipment's boxes for its labels.
 * Saving a shipment already mints them; this also covers a shipment saved
 * before boxes were minted with it, by syncing first (boxes.ts). Answers
 * { boxes: PackageView[] } in the order the labels print: by the shipment's
 * lines (the certificate's rows), each line's boxes as they were minted.
 * Syncing writes, so only the roles that receive shipments.
 */
export const POST = withAuth(async (_req: NextRequest, _ctx, routeCtx) => {
  try {
    const { id } = await (routeCtx as { params: Promise<{ id: string }> }).params;
    const shipmentId = Number(id);
    if (!Number.isInteger(shipmentId)) return NextResponse.json({ error: "מזהה משלוח לא תקין" }, { status: 400 });
    await prisma.$transaction((tx) => syncShipmentBoxes(tx, shipmentId), SHIPMENT_TX);
    const lineOrder = (b: { shipment_item_id: number | null }) => b.shipment_item_id ?? Number.MAX_SAFE_INTEGER;
    const boxes = (await loadPackages({ shipmentId })).sort((a, b) =>
      lineOrder(a) - lineOrder(b) || mintOrderKey(a.item_id).localeCompare(mintOrderKey(b.item_id)));
    return NextResponse.json({ boxes });
  } catch (error) {
    return packageErrorResponse(error, "טעינת מארזי המשלוח נכשלה");
  }
}, { role: ["manager", "storekeeper"] });
