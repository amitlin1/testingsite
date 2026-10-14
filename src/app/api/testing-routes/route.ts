import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    // The intake form needs the route list only: never the field-config
    // columns (fields_draft can be large) or anything added to the table later.
    const rows = await prisma.testing_routes.findMany({
      select: {
        test_route_id: true,
        item_type_id: true,
        test_station_type_id: true,
        route_steps: true,
        route_number: true,
      },
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
