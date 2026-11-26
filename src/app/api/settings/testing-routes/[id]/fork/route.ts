import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { forkRouteForKit } from "@/app/lib/station-fields/fork";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/testing-routes/[id]/fork — "צור מסלול נפרד למארז הזה" (spec §3.2.1,
 * artboard 2). Body { package_type_id } → 201 { test_route_id, route_number }: a copy of route [id]
 * (same steps, same step uids, its draft or published config as the new draft) that this kit's
 * template line now runs. Refusals: see fork.ts.
 */
export const POST = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await forkRouteForKit(prisma, parseDbId(id), body, actorFromSession(session)), { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to fork the testing route");
  }
}, { perm: ACCESS.fieldsEdit });
