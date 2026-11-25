import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { createRoute, listRoutes } from "@/app/lib/station-fields/route-steps";

export const runtime = "nodejs";

// Reads stay open to any signed-in user: the intake and the queues read routes
// through here too (src/lib/routes.ts). Writes need the routes page's roles.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const itemTypeId = searchParams.get("itemTypeId");
    const routeNumber = searchParams.get("routeNumber");
    return NextResponse.json(await listRoutes(prisma, {
      itemTypeId: itemTypeId ? parseInt(itemTypeId, 10) : null,
      routeNumber: routeNumber ? parseInt(routeNumber, 10) : null,
    }));
  } catch (error) {
    // A real error, never []: the settings screen reads an empty list as
    // "no route yet", so a failed read would look like a missing route.
    return errorResponse(error, "Failed to fetch testing routes");
  }
}

export const POST = withAuth(async (req) => {
  try {
    return NextResponse.json(await createRoute(prisma, await readJsonObject(req)));
  } catch (error) {
    return errorResponse(error, "Failed to create testing route");
  }
}, { role: ACCESS.fieldsEdit });
