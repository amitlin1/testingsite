import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

/**
 * Photo types — the global photo classifications ("package", "product", ...).
 *
 * Screens/pickers list these to tag reference images and worker-captured item
 * photos; code addresses a group by the stable `code`, never by the numeric id.
 * Active types only, unless `?all=1` — a test station keeps tagging its captures
 * with its group even after the type is hidden from the pickers.
 */
export async function GET(request: Request) {
  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    const rows = await prisma.photo_types.findMany({
      where: all ? {} : { is_active: true },
      orderBy: { sort_order: "asc" },
      select: { photo_type_id: true, code: true, photo_type_desc: true, sort_order: true },
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching photo types:", error);
    return NextResponse.json([], { status: 200 });
  }
}
