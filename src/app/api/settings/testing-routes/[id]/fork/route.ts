import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, parsePathId, readJsonObject } from "@/app/lib/station-fields/admin";
import { forkRouteForKit } from "@/app/lib/station-fields/fork";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/testing-routes/[id]/fork — "צור מסלול נפרד למארז הזה" (spec §3.2.1,
 * artboard 2). Body { package_type_id } → 201 { test_route_id, route_number }: a copy of route [id]
 * (same steps, same step uids, its draft or published config as the new draft) that this kit's
 * template line now runs. Refusals: see fork.ts.
 */
export const POST = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await forkRouteForKit(prisma, parsePathId(id), body, actorFromSession(session)), { status: 201 });
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to fork the testing route");
  }
}, { role: FIELDS_EDIT_ROLES });
