import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { createPackage, PackageInput, PackageItemInput } from "@/app/lib/packages/create-package";
import { packageErrorResponse } from "@/app/lib/packages/errors";

export const runtime = "nodejs";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * POST /api/packages — intake of one box and everything inside it
 * (docs/packages/PLAN.md §6). Replaces POST /api/items.
 *
 * Body:
 *   customer, shipment, packageType   numbers
 *   routeNumber                        package route, default 1
 *   makat, model, manufacturer, manufacturerNo   package fields, optional
 *   items: [{ itemType, serialNumber, makat, model, manufacturer, manufacturerNo?, routeNumber? }]
 *
 * Answers 201 { ok, packageId, itemIds } — ids as numbers (16 digits, exact).
 */
export async function POST(req: Request) {
  // createPackage emits item_created into the metrics ledger, so refuse
  // loudly when the DB is behind this image.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json();

    const customer = num(body.customer);
    const shipment = num(body.shipment);
    const packageType = num(body.packageType);
    if (customer == null || shipment == null || packageType == null) {
      return NextResponse.json({ error: "חסרים לקוח, משלוח או סוג מארז" }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "מארז חייב להכיל לפחות פריט אחד" }, { status: 400 });
    }

    const items: PackageItemInput[] = [];
    for (let i = 0; i < body.items.length; i++) {
      const raw = body.items[i] ?? {};
      const itemType = num(raw.itemType);
      const serialNumber = str(raw.serialNumber).trim();
      const makat = str(raw.makat).trim();
      const model = str(raw.model).trim();
      const manufacturer = str(raw.manufacturer).trim();
      if (itemType == null || !serialNumber || !makat || !model || !manufacturer) {
        return NextResponse.json(
          { error: `פריט ${i + 1}: יש למלא סוג, מספר סריאלי, מק"ט, דגם ויצרן`, itemIndex: i },
          { status: 400 },
        );
      }
      items.push({
        itemType,
        serialNumber,
        makat,
        model,
        manufacturer,
        manufacturerNo: raw.manufacturerNo == null ? null : str(raw.manufacturerNo).trim(),
        routeNumber: num(raw.routeNumber),
      });
    }

    const input: PackageInput = {
      customer,
      shipment,
      packageType,
      routeNumber: num(body.routeNumber),
      makat: body.makat == null ? null : str(body.makat),
      model: body.model == null ? null : str(body.model),
      manufacturer: body.manufacturer == null ? null : str(body.manufacturer),
      manufacturerNo: body.manufacturerNo == null ? null : str(body.manufacturerNo),
      items,
    };

    const created = await prisma.$transaction((tx) => createPackage(tx, input));
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (error) {
    return packageErrorResponse(error, "יצירת המארז נכשלה");
  }
}
