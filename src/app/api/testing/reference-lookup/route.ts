import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { serializeReferenceItem, referenceItemInclude } from "@/lib/reference-items";

export const runtime = "nodejs";

/**
 * Reference ("RU") lookup for the intake wizard.
 *
 * Given an item type + manufacturer SKU, returns whether a reference item exists
 * (`hasRU`), its reference weight, and its reference images — sourced from the
 * `reference_items` / `reference_item_images` tables (the /settings/reference-items
 * infrastructure). Used by the RU-check, photo-by-reference, and weighing steps.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sku = (searchParams.get("sku") ?? "").trim();
    const itemTypeIdRaw = searchParams.get("itemTypeId");
    const itemTypeId = itemTypeIdRaw != null ? Number(itemTypeIdRaw) : null;

    if (!sku) {
      return NextResponse.json({ error: "sku is required" }, { status: 400 });
    }
    if (itemTypeIdRaw != null && Number.isNaN(itemTypeId)) {
      return NextResponse.json({ error: "itemTypeId must be a number" }, { status: 400 });
    }

    const row = await prisma.reference_items.findFirst({
      where: {
        manufacturer_sku: sku,
        ...(itemTypeId != null ? { item_type_id: itemTypeId } : {}),
      },
      include: referenceItemInclude,
      orderBy: { updated_at: "desc" },
    });

    if (!row) {
      return NextResponse.json({ hasRU: false, referenceItem: null });
    }

    const ref = serializeReferenceItem(row as Parameters<typeof serializeReferenceItem>[0]);
    return NextResponse.json({
      hasRU: true,
      referenceItem: ref,
      referenceWeight: ref.reference_weight,
      images: ref.images,
      // Grouped by photo-type code ("package" | "product" | ...): each wizard
      // screen pulls only its own reference set.
      imagesByType: ref.images_by_type,
      coverUrl: ref.cover_url,
    });
  } catch (error) {
    console.error("Error in reference-lookup:", error);
    return NextResponse.json({ hasRU: false, referenceItem: null, error: "lookup failed" }, { status: 500 });
  }
}
