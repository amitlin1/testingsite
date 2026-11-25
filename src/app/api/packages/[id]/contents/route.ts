import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveOpeningContents, type OpeningAdd, type OpeningItem } from "@/app/lib/packages/boxes";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { packageIdParam } from "@/app/lib/packages/http";
import { textField } from "@/app/lib/packages/input";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

const text = (v: unknown) => textField(v).trim();
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);

/**
 * PUT /api/packages/[id]/contents — the opening station's record of what is
 * in the box (boxes.ts saveOpeningContents):
 *   items:  [{ itemId, serialNumber }]    kept, with serials
 *   remove: [itemId]                      did not come
 *   add:    [{ itemType, serialNumber }]  not in the template
 * Only serials come from the station: the details are the shipment's.
 * Answers { package }; a refusal names the row by `itemIndex` (items, then add).
 */
export function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ledgerWrite("שמירת תכולת המארז נכשלה", async () => {
    const packageId = packageIdParam((await params).id);
    const body = await req.json().catch(() => ({}));
    const items: OpeningItem[] = list(body.items).map((r) => ({ itemId: text(r.itemId), serialNumber: text(r.serialNumber) }));
    const remove: string[] = (Array.isArray(body.remove) ? body.remove : []).map(text).filter(Boolean);
    const add: OpeningAdd[] = list(body.add).map((r) => ({ itemType: Number(r.itemType), serialNumber: text(r.serialNumber) }));
    await prisma.$transaction((tx) => saveOpeningContents(tx, packageId, { items, remove, add }));
    return NextResponse.json({ ok: true, package: await loadPackage(packageId) });
  });
}
