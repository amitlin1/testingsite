import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.testing_routes.findMany({
      orderBy: { route_number: "asc" },
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error loading testing routes:", error);
    return NextResponse.json(
      { error: "Failed to load testing routes" },
      { status: 500 }
    );
  }
}
