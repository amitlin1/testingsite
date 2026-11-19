import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { errorCode, errorMessage } from "@/lib/errors";

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
    const existing = await prisma.item_status.findFirst({
      where: { item_status_desc: { equals: trimmedDesc, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json({ error: "סטטוס פריט בשם זה כבר קיים במערכת" }, { status: 400 });
    }

    const created = await prisma.item_status.create({
      data: { item_status_desc: trimmedDesc },
    });

    return NextResponse.json({
      item_status_id: created.item_status_id,
      item_status_desc: created.item_status_desc.trim(),
    });
  } catch (error) {
    const msg = errorMessage(error);
    if (errorCode(error) === "P2002" || /unique constraint/i.test(msg)) {
      return NextResponse.json({ error: "סטטוס פריט בשם זה כבר קיים במערכת" }, { status: 400 });
    }
    console.error("Error creating item status:", error);
    return NextResponse.json(
      { error: errorMessage(error) || "Failed to create item status" },
      { status: 500 }
    );
  }
}
