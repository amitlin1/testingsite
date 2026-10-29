import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { serializeReferenceItem, referenceItemWithMembersInclude } from "@/lib/reference-items";

export const runtime = "nodejs";

/**
 * Reference ("RU") lookup for the intake wizard.
 *
 * Given an item type + manufacturer SKU, returns whether a reference item exists
 * (`hasRU`), its reference weight, and its reference images by station type — sourced from the
 * `reference_items` / `reference_item_images` tables (the /settings/reference-items
 * infrastructure). Used by the RU-check, photo-by-reference, and weighing steps.
 *
 * When the item found IS a package reference (the box label at the opening
 * station), `packageMembers` carries its members — one per content line — so
 * the wizard knows what should be in the box and what each item compares against.
 *
 * Reference items are defined inside the package references (the settings page
 * offers package types only), so an item's SKU with no regular reference item
 * of its own is found among the members: the latest member of that type with
 * that SKU, with its images by station and weight, and no members of its own.
 * A regular reference item, where an older one still exists, comes first.
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

    const byType = itemTypeId != null ? { item_type_id: itemTypeId } : {};
    const row =
      (await prisma.reference_items.findFirst({
        where: { manufacturer_sku: sku, parent_reference_id: null, ...byType },
        include: referenceItemWithMembersInclude,
        orderBy: { updated_at: "desc" },
      })) ??
      (await prisma.reference_items.findFirst({
        where: { manufacturer_sku: sku, parent_reference_id: { not: null }, ...byType },
        include: referenceItemWithMembersInclude,
        orderBy: { updated_at: "desc" },
      }));

    if (!row) {
      return NextResponse.json({ hasRU: false, referenceItem: null });
    }

    const { members, ...ref } = serializeReferenceItem(row);
    return NextResponse.json({
      hasRU: true,
      referenceItem: ref,
      referenceWeight: ref.reference_weight,
      images: ref.images,
      // By station type ("<test_station_type_id>"): each station shows only its own images.
      imagesByStation: ref.images_by_station,
      coverUrl: ref.cover_url,
      packageMembers: members.map((m) => ({
        item_type_id: m.item_type_id,
        item_type_desc: m.item_type_desc,
        referenceItem: { ...m, members: undefined },
        referenceWeight: m.reference_weight,
        imagesByStation: m.images_by_station,
        coverUrl: m.cover_url,
      })),
    });
  } catch (error) {
    console.error("Error in reference-lookup:", error);
    return NextResponse.json({ hasRU: false, referenceItem: null, error: "lookup failed" }, { status: 500 });
  }
}
