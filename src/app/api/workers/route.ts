import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.workers.findMany({
      orderBy: { worker_name: "asc" },
    });

    const workers = rows.map((row) => ({
      id: row.worker_id,
      name: row.worker_name,
      stokekeeper: row.stokekeeper,
    }));

    return NextResponse.json(workers);
  } catch (error) {
    console.error("Error loading workers:", error);
    return NextResponse.json([], { status: 500 });
  }
}
