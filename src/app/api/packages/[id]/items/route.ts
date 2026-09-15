import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { addPackageItem, PackageItemInput } from "@/app/lib/packages/create-package";
import { packageErrorResponse } from "@/app/lib/packages/errors";

export const runtime = "nodejs";

/**
 * POST /api/packages/[id]/items — add one item to a package that is still at
 * its opening station (the intake wizard's "add missing item" path). Customer
 * and shipment come from the package; the item gets the next position and its
 * own route. Replaces POST /api/testing/accessory.
 *
 * Body: { itemType, serialNumber, makat, model, manufacturer, manufacturerNo?, routeNumber? }
 * Answers 201 { ok, itemId, packageSeq }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const { id } = await params;
    let packageId: bigint;
    try {
      packageId = BigInt(parseBarcode(id).itemId);
    } catch {
      return NextResponse.json({ error: "מזהה מארז לא תקין" }, { status: 400 });
    }

    const body = await req.json();
    const itemType = Number(body.itemType);
    const serialNumber = body.serialNumber == null ? "" : String(body.serialNumber).trim();
    const makat = body.makat == null ? "" : String(body.makat).trim();
    const model = body.model == null ? "" : String(body.model).trim();
    const manufacturer = body.manufacturer == null ? "" : String(body.manufacturer).trim();
    if (!Number.isFinite(itemType) || !serialNumber || !makat || !model || !manufacturer) {
      return NextResponse.json({ error: "יש למלא סוג, מספר סריאלי, מק\"ט, דגם ויצרן" }, { status: 400 });
    }

    const item: PackageItemInput = {
      itemType,
      serialNumber,
      makat,
      model,
      manufacturer,
      manufacturerNo: body.manufacturerNo == null ? null : String(body.manufacturerNo).trim(),
      routeNumber: body.routeNumber == null || body.routeNumber === "" ? null : Number(body.routeNumber),
    };

    const added = await prisma.$transaction((tx) => addPackageItem(tx, packageId, item));
    return NextResponse.json({ ok: true, ...added }, { status: 201 });
  } catch (error) {
    return packageErrorResponse(error, "הוספת הפריט למארז נכשלה");
  }
}
