import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { syncShipmentBoxes } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { loadPackages } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * POST /api/shipments/[id]/boxes — the shipment's boxes for its labels.
 * Saving a shipment already mints them; this also covers a shipment saved
 * before boxes were minted with it, by syncing first (boxes.ts). Answers
 * { boxes: PackageView[] } in id order — the order the labels print.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const shipmentId = Number(id);
    if (!Number.isInteger(shipmentId)) return NextResponse.json({ error: "מזהה משלוח לא תקין" }, { status: 400 });
    await prisma.$transaction((tx) => syncShipmentBoxes(tx, shipmentId));
    const boxes = (await loadPackages({ shipmentId })).sort((a, b) => (BigInt(a.item_id) < BigInt(b.item_id) ? -1 : 1));
    return NextResponse.json({ boxes });
  } catch (error) {
    return packageErrorResponse(error, "טעינת מארזי המשלוח נכשלה");
  }
}
