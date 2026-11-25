import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { insertLookupRow, listJson, requiredText } from "@/app/lib/lookups";
import { parseDefaultRoute } from "@/app/lib/packages/template-wire";
import { itemTypeName } from "./name";

export const runtime = "nodejs";

/**
 * Item types, including PACKAGE types (is_package) — the box a customer
 * ships, whose contents are edited through /api/settings/item-types/[id]/contents.
 */
export async function GET() {
  // A real error, never []: a settings screen reads an empty list as "no item
  // types", and the seed scripts would create the "missing" ones (route-fields
  // spec §11 rule 12).
  return listJson(async () => {
    const rows = await prisma.item_types.findMany({
      orderBy: { item_type_id: "asc" },
      include: { _count: { select: { package_contents: true } } },
    });
    return rows.map((r) => ({
      item_type_id: r.item_type_id,
      item_type_desc: r.item_type_desc.trim(),
      is_package: r.is_package,
      default_route_number: r.default_route_number,
      contents_count: r._count.package_contents,
    }));
  }, "Failed to fetch item types");
}

export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    const desc = requiredText(body.item_type_desc);
    if (!desc) throw new HttpError(400, "Description is required");
    const isPackage = Boolean(body.is_package);
    const route = parseDefaultRoute(body.default_route_number);
    if ("error" in route) throw new HttpError(400, route.error);

    const created = await insertLookupRow(
      () => prisma.item_types.create({
        data: { item_type_desc: desc, is_package: isPackage, default_route_number: isPackage ? route.value : null },
      }),
      { duplicate: itemTypeName(desc) },
    );
    return NextResponse.json({
      item_type_id: created.item_type_id,
      item_type_desc: created.item_type_desc.trim(),
      is_package: created.is_package,
      default_route_number: created.default_route_number,
      contents_count: 0,
    });
  } catch (error) {
    return errorResponse(error, "Failed to create item type");
  }
}
