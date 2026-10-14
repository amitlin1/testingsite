import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, parsePathId, readJsonObject } from "@/app/lib/station-fields/admin";
import { propagateOptionList } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/option-lists/[id]/propagate — the linked fields (all, or `targets`) take the
 * list's current options in their routes' DRAFTS; nothing is published (artboard 4). Body
 * { targets?: {route_id, step_uid, field_id}[] } → { updated_drafts }.
 */
export const POST = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await propagateOptionList(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to propagate the option list");
  }
}, { role: FIELDS_EDIT_ROLES });
