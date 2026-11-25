import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { actorFromSession } from "@/lib/auth/identity";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { prismaRefusal } from "@/app/lib/lookups";
import { saveRouteSteps } from "@/app/lib/station-fields/route-steps";

export const runtime = "nodejs";

// Only the steps change (key fields are immutable): body { route_steps, step_uids? }.
// The step uids, the draft and the first station type follow them in one
// transaction — see saveRouteSteps.
export const PUT = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await prisma.$transaction((tx) => saveRouteSteps(tx, parseDbId(id), body, actorFromSession(session))));
  } catch (error) {
    return errorResponse(error, "Failed to update testing route");
  }
}, { role: ACCESS.fieldsEdit });

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const routeId = parseDbId(id);
    if (routeId === null) throw new HttpError(404, "Route not found");
    await prisma.testing_routes.delete({ where: { test_route_id: routeId } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return prismaRefusal(error, {
      notFound: "Route not found",
      inUse: "Cannot delete route because it is referenced by other records.",
    }, "Failed to delete testing route");
  }
}
