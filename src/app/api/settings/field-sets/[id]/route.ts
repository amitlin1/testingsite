import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, parsePathId, readJsonObject } from "@/app/lib/station-fields/admin";
import { deleteFieldSet, updateFieldSet } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * PUT /api/settings/field-sets/[id] — "שמירה כגרסה {v+1}" (artboard 8). Body
 * { name, fields, base_version } → { version }; 409 VERSION_CONFLICT { current } when base_version
 * is stale.
 */
export const PUT = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await updateFieldSet(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to save the field set");
  }
}, { role: FIELDS_EDIT_ROLES });

/** DELETE /api/settings/field-sets/[id] → { id, archived: true }; 409 IN_USE while it is used. */
export const DELETE = withAuth(async (_req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    return NextResponse.json(await deleteFieldSet(prisma, parsePathId(id), actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to delete the field set");
  }
}, { role: FIELDS_EDIT_ROLES });
