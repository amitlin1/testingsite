import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { IN_USE_TEXT, assertNameFree, prismaRefusal, requiredText } from "@/app/lib/lookups";
import { parseDefaultRoute } from "@/app/lib/packages/template-wire";
import { itemTypeName } from "../name";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const NOT_FOUND = "Item type not found";

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const id = parseDbId((await params).id);
    const body = await readJsonObject(req);
    const desc = requiredText(body.item_type_desc);
    if (!desc) throw new HttpError(400, "Description is required");
    if (id === null) throw new HttpError(404, NOT_FOUND);
    await assertNameFree(itemTypeName(desc), id);

    // is_package is optional in the body (an old client sends only the name).
    // Turning a package type back into a plain type is refused while it still
    // has contents or packages: both would silently become nonsense.
    const data: { item_type_desc: string; is_package?: boolean; default_route_number?: number | null } = { item_type_desc: desc };
    if (body.default_route_number !== undefined) {
      const route = parseDefaultRoute(body.default_route_number);
      if ("error" in route) throw new HttpError(400, route.error);
      data.default_route_number = route.value;
    }
    if (body.is_package !== undefined) {
      const nextIsPackage = Boolean(body.is_package);
      const current = await prisma.item_types.findUnique({
        where: { item_type_id: id },
        select: { is_package: true, _count: { select: { package_contents: true, contained_in: true } } },
      });
      if (!current) throw new HttpError(404, NOT_FOUND);
      if (current.is_package && !nextIsPackage) {
        if (current._count.package_contents > 0) {
          throw new HttpError(409, "לסוג המארז יש תכולה מוגדרת — יש למחוק אותה לפני ביטול הסימון");
        }
        if ((await prisma.items.count({ where: { item_type_id: id, package_id: null } })) > 0) {
          throw new HttpError(409, "קיימים מארזים מסוג זה — לא ניתן לבטל את הסימון");
        }
      }
      if (!current.is_package && nextIsPackage) {
        if (current._count.contained_in > 0) {
          throw new HttpError(409, "סוג הפריט מופיע בתכולה של מארז — סוג מארז לא יכול להיות בתוך מארז");
        }
        if ((await prisma.items.count({ where: { item_type_id: id, package_id: { not: null } } })) > 0) {
          throw new HttpError(409, "קיימים פריטים מסוג זה בתוך מארזים — לא ניתן להפוך אותו לסוג מארז");
        }
      }
      data.is_package = nextIsPackage;
    }

    const updated = await prisma.item_types.update({
      where: { item_type_id: id },
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
    return prismaRefusal(error, { notFound: NOT_FOUND }, "Failed to update item type");
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const itemTypeId = parseDbId(id);
    if (itemTypeId === null) throw new HttpError(404, NOT_FOUND);
    await prisma.item_types.delete({ where: { item_type_id: itemTypeId } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return prismaRefusal(error, {
      notFound: NOT_FOUND,
      inUse: IN_USE_TEXT,
    }, "Failed to delete item type");
  }
}
