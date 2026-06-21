import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.workers.findMany({
      orderBy: { worker_name: "asc" },
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error loading workers:", error);
    return NextResponse.json([], { status: 500 });
  }
}
