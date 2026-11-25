import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId } from "@/lib/http/request";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { syncShipmentBoxes } from "@/app/lib/packages/boxes";
import { mintOrderKey } from "@/app/lib/packages/ids";
import { loadPackages } from "@/app/lib/packages/read";
import { SHIPMENT_TX } from "@/app/lib/shipments/save";

export const runtime = "nodejs";

/**
 * POST /api/shipments/[id]/boxes — the shipment's boxes for its labels.
 * Saving a shipment already mints them; this also covers a shipment saved
 * before boxes were minted with it, by syncing first (boxes.ts). Answers
 * { boxes: PackageView[] } in the order the labels print: by the shipment's
 * lines (the certificate's rows), each line's boxes as they were minted.
 * Syncing writes, so only the roles that receive shipments.
 */
export const POST = withAuth<{ id: string }>(async (_req: NextRequest, { params: { id } }) => {
  try {
    const shipmentId = parseDbId(id);
    if (shipmentId == null) return NextResponse.json({ error: "מזהה משלוח לא תקין" }, { status: 400 });
    await prisma.$transaction((tx) => syncShipmentBoxes(tx, shipmentId), SHIPMENT_TX);
    const lineOrder = (b: { shipment_item_id: number | null }) => b.shipment_item_id ?? Number.MAX_SAFE_INTEGER;
    const boxes = (await loadPackages({ shipmentId })).sort((a, b) =>
      lineOrder(a) - lineOrder(b) || mintOrderKey(a.item_id).localeCompare(mintOrderKey(b.item_id)));
    return NextResponse.json({ boxes });
  } catch (error) {
    return errorResponse(error, "טעינת מארזי המשלוח נכשלה");
  }
}, { role: ACCESS.shipments });
