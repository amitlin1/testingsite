import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/testing/reference-skus?itemTypeId=<id>
 *
 * The manufacturer SKUs of one item type's reference items
 * (/settings/reference-items), for the scan field's suggestions: the worker
 * may tap one instead of scanning. Only SKU / name / manufacturer — the
 * lookup of the SKU picked (reference-lookup) brings images and weights.
 * A package reference's members are never listed on their own.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemTypeId = Number(searchParams.get("itemTypeId"));
    if (!Number.isInteger(itemTypeId) || itemTypeId <= 0) {
      return NextResponse.json({ error: "itemTypeId is required" }, { status: 400 });
    }

    const rows = await prisma.reference_items.findMany({
      where: { item_type_id: itemTypeId, parent_reference_id: null },
      select: { manufacturer_sku: true, name: true, manufacturer: true },
      orderBy: { updated_at: "desc" },
    });

    // One entry per SKU: the lookup answers with the latest item of a SKU anyway.
    const seen = new Set<string>();
    const skus = rows.flatMap((r) => {
      const sku = r.manufacturer_sku.trim();
      if (!sku || seen.has(sku)) return [];
      seen.add(sku);
      return [{ sku, name: r.name ?? null, manufacturer: r.manufacturer || null }];
    });
    return NextResponse.json(skus);
  } catch (error) {
    console.error("Error listing reference SKUs:", error);
    return NextResponse.json({ error: "שגיאה בטעינת מק״טי הייחוס" }, { status: 500 });
  }
}
