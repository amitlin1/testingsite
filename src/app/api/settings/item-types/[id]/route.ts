import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { parseDefaultRoute } from "@/app/lib/packages/settings";

export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const idNum = Number(id);
    const body = await req.json();
    const { item_type_desc } = body;

    if (!item_type_desc || typeof item_type_desc !== "string" || !item_type_desc.trim()) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }

    const trimmedDesc = item_type_desc.trim();

    const existing = await prisma.item_types.findFirst({
      where: {
        item_type_desc: { equals: trimmedDesc, mode: 'insensitive' },
        NOT: { item_type_id: idNum }
      }
    });

    if (existing) {
      return NextResponse.json({ error: "סוג פריט זה כבר קיים במערכת" }, { status: 400 });
    }

    // is_package is optional in the body (an old client sends only the name).
    // Turning a package type back into a plain type is refused while it still
    // has contents or packages: both would silently become nonsense.
    const data: { item_type_desc: string; is_package?: boolean; default_route_number?: number | null } = { item_type_desc: trimmedDesc };
    if (body.default_route_number !== undefined) {
      const route = parseDefaultRoute(body.default_route_number);
      if ("error" in route) return NextResponse.json({ error: route.error }, { status: 400 });
      data.default_route_number = route.value;
    }
    if (body.is_package !== undefined) {
      const nextIsPackage = Boolean(body.is_package);
      const current = await prisma.item_types.findUnique({
        where: { item_type_id: idNum },
        select: { is_package: true, _count: { select: { package_contents: true, contained_in: true } } },
      });
      if (!current) return NextResponse.json({ error: "Item type not found" }, { status: 404 });
      if (current.is_package && !nextIsPackage) {
        if (current._count.package_contents > 0) {
          return NextResponse.json({ error: "לסוג המארז יש תכולה מוגדרת — יש למחוק אותה לפני ביטול הסימון" }, { status: 409 });
        }
        const packages = await prisma.items.count({ where: { item_type_id: idNum, package_id: null } });
        if (packages > 0) {
          return NextResponse.json({ error: "קיימים מארזים מסוג זה — לא ניתן לבטל את הסימון" }, { status: 409 });
        }
      }
      if (!current.is_package && nextIsPackage) {
        if (current._count.contained_in > 0) {
          return NextResponse.json({ error: "סוג הפריט מופיע בתכולה של מארז — סוג מארז לא יכול להיות בתוך מארז" }, { status: 409 });
        }
        const inside = await prisma.items.count({ where: { item_type_id: idNum, package_id: { not: null } } });
        if (inside > 0) {
          return NextResponse.json({ error: "קיימים פריטים מסוג זה בתוך מארזים — לא ניתן להפוך אותו לסוג מארז" }, { status: 409 });
        }
      }
      data.is_package = nextIsPackage;
    }

    const updated = await prisma.item_types.update({
      where: { item_type_id: idNum },
      data,
      include: { _count: { select: { package_contents: true } } },
    });

    return NextResponse.json({
      item_type_id: updated.item_type_id,
      item_type_desc: updated.item_type_desc.trim(),
      is_package: updated.is_package,
      default_route_number: updated.default_route_number,
      contents_count: updated._count.package_contents,
    });

  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Item type not found" }, { status: 404 });
    }
    console.error("Error updating item type:", error);
    return NextResponse.json(
      { error: "Failed to update item type" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.item_types.delete({
      where: { item_type_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Item type not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete item type because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting item type:", error);
    return NextResponse.json(
      { error: "Failed to delete item type" },
      { status: 500 }
    );
  }
}
