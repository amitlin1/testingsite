import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { saveOpeningContents, type OpeningAdd, type OpeningItem } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

const str = (v: unknown) => (v == null ? "" : String(v).trim());

/**
 * PUT /api/packages/[id]/contents — the opening station's record of what is
 * in the box (boxes.ts saveOpeningContents):
 *   items:  [{ itemId, serialNumber }]    kept, with serials
 *   remove: [itemId]                      did not come
 *   add:    [{ itemType, serialNumber }]  not in the template
 * Only serials come from the station: the details are the shipment's.
 * Answers { package }; a refusal names the row by `itemIndex` (items, then add).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const body = await req.json().catch(() => ({}));
    const items: OpeningItem[] = (Array.isArray(body.items) ? body.items : []).map((r: Record<string, unknown>) => ({
      itemId: str(r.itemId), serialNumber: str(r.serialNumber),
    }));
    const remove: string[] = (Array.isArray(body.remove) ? body.remove : []).map(str).filter(Boolean);
    const add: OpeningAdd[] = (Array.isArray(body.add) ? body.add : []).map((r: Record<string, unknown>) => ({
      itemType: Number(r.itemType), serialNumber: str(r.serialNumber),
    }));
    await prisma.$transaction((tx) => saveOpeningContents(tx, packageId, { items, remove, add }));
    return NextResponse.json({ ok: true, package: await loadPackage(packageId) });
  } catch (error) {
    return packageErrorResponse(error, "שמירת תכולת המארז נכשלה");
  }
}
