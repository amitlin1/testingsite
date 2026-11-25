import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addItemToPackage } from "@/app/lib/packages/create-package";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { packageIdParam } from "@/app/lib/packages/http";
import { readItemInput } from "@/app/lib/packages/input";

export const runtime = "nodejs";

/**
 * POST /api/packages/[id]/items — add one item to a package that is still at
 * its opening station (the intake wizard's "add missing item" path). Customer
 * and shipment come from the package; the item gets the next position and its
 * own route (create-package.ts addItemToPackage).
 *
 * Body: { itemType, serialNumber, makat, model, manufacturer, manufacturerNo?, routeNumber? }
 * Answers 201 { ok, itemId, packageSeq }.
 */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ledgerWrite("הוספת הפריט למארז נכשלה", async () => {
    const packageId = packageIdParam((await params).id);
    const item = readItemInput(await req.json());
    if (!item) return NextResponse.json({ error: "יש למלא סוג ומספר סריאלי" }, { status: 400 });
    const added = await prisma.$transaction((tx) => addItemToPackage(tx, packageId, item));
    return NextResponse.json({ ok: true, ...added }, { status: 201 });
  });
}
