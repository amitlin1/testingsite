import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.item_status.findMany({
      orderBy: { item_status_id: "asc" },
    });

    const trimmed = rows.map((r) => ({
      item_status_id: r.item_status_id,
      item_status_desc: r.item_status_desc.trim(),
    }));

    return NextResponse.json(trimmed);
  } catch (error) {
    console.error("Error fetching item statuses:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { item_status_desc } = body;

  if (!item_status_desc || typeof item_status_desc !== "string" || !item_status_desc.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  const trimmedDesc = item_status_desc.trim();

  try {
    const created = await prisma.item_status.create({
      data: { item_status_desc: trimmedDesc },
    });

    return NextResponse.json({
      item_status_id: created.item_status_id,
      item_status_desc: created.item_status_desc.trim(),
    });
  } catch (error: any) {
    console.error("Error creating item status:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create item status" },
      { status: 500 }
    );
  }
}
