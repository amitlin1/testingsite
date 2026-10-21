import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { serializeReferenceItem, referenceItemWithMembersInclude } from "@/lib/reference-items";

export const runtime = "nodejs";

/**
 * Reference ("RU") lookup for the intake wizard.
 *
 * Given an item type + manufacturer SKU, returns whether a reference item exists
 * (`hasRU`), its reference weight, and its reference images — sourced from the
 * `reference_items` / `reference_item_images` tables (the /settings/reference-items
 * infrastructure). Used by the RU-check, photo-by-reference, and weighing steps.
 *
 * A package reference's members are never found on their own. When the item
 * found IS a package reference (the box label at the opening station),
 * `packageMembers` carries its members — one per content line — so the
 * wizard knows what should be in the box and what each item compares against.
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
        parent_reference_id: null,
        ...(itemTypeId != null ? { item_type_id: itemTypeId } : {}),
      },
      include: referenceItemWithMembersInclude,
      orderBy: { updated_at: "desc" },
    });

    if (!row) {
      return NextResponse.json({ hasRU: false, referenceItem: null });
    }

    const { members, ...ref } = serializeReferenceItem(row);
    return NextResponse.json({
      hasRU: true,
      referenceItem: ref,
      referenceWeight: ref.reference_weight,
      images: ref.images,
      // Grouped by photo-type code ("package" | "product" | ...): each wizard
      // screen pulls only its own reference set.
      imagesByType: ref.images_by_type,
      coverUrl: ref.cover_url,
      packageMembers: members.map((m) => ({
        item_type_id: m.item_type_id,
        item_type_desc: m.item_type_desc,
        referenceItem: { ...m, members: undefined },
        referenceWeight: m.reference_weight,
        imagesByType: m.images_by_type,
        coverUrl: m.cover_url,
      })),
    });
  } catch (error) {
    console.error("Error in reference-lookup:", error);
    return NextResponse.json({ hasRU: false, referenceItem: null, error: "lookup failed" }, { status: 500 });
  }
}
