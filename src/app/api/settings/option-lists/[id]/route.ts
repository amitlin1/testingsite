import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, parsePathId, readJsonObject } from "@/app/lib/station-fields/admin";
import { deleteOptionList, updateOptionList } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * PUT /api/settings/option-lists/[id] — a new version of the list (spec §5.7 "החל על השדה"). Body
 * { name, options, base_version } → { version, linked: {route_id, step_uid, field_id}[] };
 * 409 VERSION_CONFLICT { current } when base_version is stale.
 */
export const PUT = withAuth(async (req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    const body = await readJsonObject(req);
    return NextResponse.json(await updateOptionList(prisma, parsePathId(id), body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to save the option list");
  }
}, { role: FIELDS_EDIT_ROLES });

/** DELETE /api/settings/option-lists/[id] → { id, archived: true }; 409 IN_USE while it is used. */
export const DELETE = withAuth(async (_req, { session }, routeCtx) => {
  try {
    const { id } = await (routeCtx as RouteCtx).params;
    return NextResponse.json(await deleteOptionList(prisma, parsePathId(id), actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to delete the option list");
  }
}, { role: FIELDS_EDIT_ROLES });
