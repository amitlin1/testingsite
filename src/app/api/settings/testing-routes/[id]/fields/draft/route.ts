import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import {
  actorFromSession,
  adminFieldsErrorResponse,
  discardFieldsDraft,
  parsePathId,
  readJsonObject,
  saveFieldsDraft,
} from "@/app/lib/station-fields/admin";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * PUT /api/settings/testing-routes/[id]/fields/draft — autosave of the route's field-config draft
 * (spec §3.2, §3.4.1). Body { config, base_rev } → { draft_rev, draft_updated_at, issues }.
 */
export const PUT = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await saveFieldsDraft(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to save the fields draft");
  }
}, { role: FIELDS_EDIT_ROLES });

/**
 * DELETE /api/settings/testing-routes/[id]/fields/draft — "ביטול הטיוטה". Body { base_rev } →
 * { draft_rev }.
 */
export const DELETE = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await discardFieldsDraft(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to discard the fields draft");
  }
}, { role: FIELDS_EDIT_ROLES });
