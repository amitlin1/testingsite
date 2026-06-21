import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.item_types.findMany({
      orderBy: { item_type_desc: "asc" },
    });

    const itemTypes = rows.map((row) => ({
      id: row.item_type_id,
      name: (row.item_type_desc ?? "").trim(),
    }));

    return NextResponse.json(itemTypes);
  } catch (error) {
    console.error("Error loading item types:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}
