import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/auth/withAuth";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";
import { RouteStepsError, saveRouteSteps } from "@/app/lib/station-fields/route-steps";

export const runtime = "nodejs";

// Only the steps change (key fields are immutable): body { route_steps, step_uids? }.
// The step uids, the draft and the first station type follow them in one
// transaction — see saveRouteSteps.
export const PUT = withAuth(async (req, ctx, routeCtx) => {
  try {
    const { id } = await (routeCtx as { params: Promise<{ id: string }> }).params;
    const body = await req.json();
    const actor = ctx.session.user.preferredUsername || null;

    const saved = await prisma.$transaction((tx) => saveRouteSteps(tx, Number(id), body, actor));

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof RouteStepsError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Error updating testing route:", error);
    return NextResponse.json(
      { error: "Failed to update testing route" },
      { status: 500 }
    );
  }
}, { role: FIELDS_EDIT_ROLES });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    await prisma.testing_routes.delete({
      where: { test_route_id: Number(id) },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Route not found" }, { status: 404 });
      }
      if (error.code === "P2003") {
        return NextResponse.json(
          { error: "Cannot delete route because it is referenced by other records." },
          { status: 409 }
        );
      }
    }
    console.error("Error deleting testing route:", error);
    return NextResponse.json(
      { error: "Failed to delete testing route" },
      { status: 500 }
    );
  }
}
