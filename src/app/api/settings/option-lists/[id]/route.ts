import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { deleteOptionList, updateOptionList } from "@/app/lib/station-fields/library";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * PUT /api/settings/option-lists/[id] — a new version of the list (spec §5.7 "החל על השדה"). Body
 * { name, options, base_version } → { version, linked: {route_id, step_uid, field_id}[] };
 * 409 VERSION_CONFLICT { current } when base_version is stale.
 */
export const PUT = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await updateOptionList(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to save the option list");
  }
}, { role: ACCESS.fieldsEdit });

/** DELETE /api/settings/option-lists/[id] → { id, archived: true }; 409 IN_USE while it is used. */
export const DELETE = withAuth<{ id: string }>(async (_req, { session, params: { id } }) => {
  try {
    return NextResponse.json(await deleteOptionList(prisma, parseDbId(id), actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to delete the option list");
  }
}, { role: ACCESS.fieldsEdit });
