import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";
import { RouteStepsError, createRoute, listRoutes } from "@/app/lib/station-fields/route-steps";

export const runtime = "nodejs";

// Reads stay open to any signed-in user: the intake and the queues read routes
// through here too (src/lib/routes.ts). Writes need the routes page's roles.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemTypeId = searchParams.get("itemTypeId");
    const routeNumber = searchParams.get("routeNumber");

    const rows = await listRoutes(prisma, {
      itemTypeId: itemTypeId ? parseInt(itemTypeId, 10) : null,
      routeNumber: routeNumber ? parseInt(routeNumber, 10) : null,
    });

    return NextResponse.json(rows);
  } catch (error) {
    if (error instanceof RouteStepsError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Error fetching testing routes:", error);
    // A real error, never []: the settings screen reads an empty list as
    // "no route yet", so a failed read would look like a missing route.
    return NextResponse.json({ error: "Failed to fetch testing routes" }, { status: 500 });
  }
}

export const POST = withAuth(async (req) => {
  const body = await req.json();

  try {
    const created = await createRoute(prisma, body);
    return NextResponse.json(created);
  } catch (error: any) {
    if (error instanceof RouteStepsError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Error creating testing route:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create testing route" },
      { status: 500 }
    );
  }
}, { role: FIELDS_EDIT_ROLES });
