import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, parsePathId, readJsonObject } from "@/app/lib/station-fields/admin";
import { propagateFieldSet } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * POST /api/settings/field-sets/[id]/propagate — "עדכן את כולם ({n})" (artboard 8): the outdated
 * cells (all, or those holding a target's field) take the set's current fields in their routes'
 * DRAFTS; nothing is published. Body { targets?: {route_id, step_uid, field_id}[] } →
 * { updated_drafts }.
 */
export const POST = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await propagateFieldSet(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to propagate the field set");
  }
}, { role: FIELDS_EDIT_ROLES });
