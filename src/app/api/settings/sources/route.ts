import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.sources.findMany({
      orderBy: { source_id: "asc" },
    });

    const trimmed = rows.map((r) => ({
      source_id: r.source_id,
      source_desc: r.source_desc.trim(),
    }));

    return NextResponse.json(trimmed);
  } catch (error) {
    console.error("Error fetching sources:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { source_desc } = body;

  if (!source_desc || typeof source_desc !== "string" || !source_desc.trim()) {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  const trimmedDesc = source_desc.trim();

  try {
    const existing = await prisma.sources.findFirst({
      where: { source_desc: { equals: trimmedDesc, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json({ error: "מקור בשם זה כבר קיים במערכת" }, { status: 400 });
    }

    const created = await prisma.sources.create({
      data: { source_desc: trimmedDesc },
    });

    return NextResponse.json({
      source_id: created.source_id,
      source_desc: created.source_desc.trim(),
    });
  } catch (error: any) {
    const msg = String(error?.message ?? "");
    if (error?.code === "P2002" || /unique constraint/i.test(msg)) {
      return NextResponse.json({ error: "מקור בשם זה כבר קיים במערכת" }, { status: 400 });
    }
    console.error("Error creating source:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create source" },
      { status: 500 }
    );
  }
}
