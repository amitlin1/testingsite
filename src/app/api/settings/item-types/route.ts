import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseDefaultRoute } from "@/app/lib/packages/settings";

export const runtime = "nodejs";

/**
 * Item types, including PACKAGE types (is_package) — the box a customer
 * ships, whose contents are edited through /api/settings/item-types/[id]/contents.
 */
export async function GET() {
  try {
    const rows = await prisma.item_types.findMany({
      orderBy: { item_type_id: "asc" },
      include: { _count: { select: { package_contents: true } } },
    });

    const trimmed = rows.map((r) => ({
      item_type_id: r.item_type_id,
      item_type_desc: r.item_type_desc.trim(),
      is_package: r.is_package,
      default_route_number: r.default_route_number,
      contents_count: r._count.package_contents,
    }));

    return NextResponse.json(trimmed);
  } catch (error) {
    console.error("Error fetching item types:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { item_type_desc } = body;
  const isPackage = Boolean(body.is_package);

  if (!item_type_desc || typeof item_type_desc !== "string" || !item_type_desc.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }
  const route = parseDefaultRoute(body.default_route_number);
  if ("error" in route) return NextResponse.json({ error: route.error }, { status: 400 });

  const trimmedDesc = item_type_desc.trim();

  try {
    const existing = await prisma.item_types.findFirst({
      where: {
        item_type_desc: {
          equals: trimmedDesc,
          mode: 'insensitive'
        }
      }
    });
    if (existing) {
      return NextResponse.json(
        { error: "סוג פריט זה כבר קיים במערכת" },
        { status: 400 }
      );
    }

    const created = await prisma.item_types.create({
      data: { item_type_desc: trimmedDesc, is_package: isPackage, default_route_number: isPackage ? route.value : null },
    });

    return NextResponse.json({
      item_type_id: created.item_type_id,
      item_type_desc: created.item_type_desc.trim(),
      is_package: created.is_package,
      default_route_number: created.default_route_number,
      contents_count: 0,
    });
  } catch (error: any) {
    const msg = String(error?.message ?? "");
    if (error?.code === "P2002" || /unique constraint/i.test(msg)) {
      return NextResponse.json({ error: "סוג פריט זה כבר קיים במערכת" }, { status: 400 });
    }
    console.error("Error creating item type:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create item type" },
      { status: 500 }
    );
  }
}
