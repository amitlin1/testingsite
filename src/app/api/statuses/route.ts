import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.item_status.findMany({
      orderBy: { item_status_id: "asc" },
    });

    const statuses = rows.map((row) => ({
      id: row.item_status_id,
      label: (row.item_status_desc ?? "").trim(),
    }));

    return NextResponse.json(statuses);
  } catch (error) {
    console.error("Error loading statuses:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}
