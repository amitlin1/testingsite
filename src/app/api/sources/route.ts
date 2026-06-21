import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.sources.findMany({
      orderBy: { source_id: "asc" },
    });

    const sources = rows.map((row) => ({
      id: row.source_id,
      desc: (row.source_desc ?? "").trim(),
    }));

    return NextResponse.json(sources);
  } catch (error) {
    console.error("Error fetching sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch sources" },
      { status: 500 }
    );
  }
}
