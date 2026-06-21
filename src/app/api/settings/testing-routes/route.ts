import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemTypeId = searchParams.get("itemTypeId");
    const routeNumber = searchParams.get("routeNumber");

    const where: Record<string, unknown> = {};
    if (itemTypeId) where.item_type_id = parseInt(itemTypeId, 10);
    if (routeNumber) where.route_number = parseInt(routeNumber, 10);

    const rows = await prisma.testing_routes.findMany({
      where,
      select: {
        test_route_id: true,
        item_type_id: true,
        test_station_type_id: true,
        route_number: true,
        route_steps: true,
      },
    });

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching testing routes:", error);
    // Return empty array instead of error to prevent frontend crashes
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const { item_type_id, route_number, route_steps } = body;

  if (!item_type_id || route_number === undefined || route_number === null) {
    return NextResponse.json({ error: "Item Type and Route Number are required" }, { status: 400 });
  }

  const finalRouteSteps: number[] = route_steps || [];

  try {
    // Check uniqueness - need to check by item_type_id and route_number
    const existing = await prisma.testing_routes.findFirst({
      where: { item_type_id, route_number },
    });
    if (existing) {
      return NextResponse.json({ error: "מסלול עבור שילוב זה כבר קיים במערכת" }, { status: 409 });
    }

    // Get test_station_type_id from first route step
    let test_station_type_id: number | null = null;
    if (finalRouteSteps.length > 0) {
      test_station_type_id = finalRouteSteps[0];
    } else {
      // Try to get from existing route with same item_type_id
      const anyRoute = await prisma.testing_routes.findFirst({
        where: { item_type_id },
        select: { test_station_type_id: true },
      });
      if (anyRoute) {
        test_station_type_id = anyRoute.test_station_type_id;
      }
    }

    if (!test_station_type_id) {
      return NextResponse.json(
        { error: "לא ניתן לקבוע סוג עמדה התחלתית. נא להוסיף שלב למסלול תחילה." },
        { status: 400 }
      );
    }

    const created = await prisma.testing_routes.create({
      data: {
        item_type_id,
        test_station_type_id,
        route_number,
        route_steps: finalRouteSteps,
      },
    });

    return NextResponse.json({
      test_route_id: created.test_route_id,
      item_type_id: created.item_type_id,
      test_station_type_id: created.test_station_type_id,
      route_number: created.route_number,
      route_steps: created.route_steps,
    });
  } catch (error: any) {
    console.error("Error creating testing route:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create testing route" },
      { status: 500 }
    );
  }
}
