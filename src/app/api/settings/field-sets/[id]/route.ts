import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { deleteFieldSet, updateFieldSet } from "@/app/lib/station-fields/library";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * PUT /api/settings/field-sets/[id] — "שמירה כגרסה {v+1}" (artboard 8). Body
 * { name, fields, base_version } → { version }; 409 VERSION_CONFLICT { current } when base_version
 * is stale.
 */
export const PUT = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await updateFieldSet(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to save the field set");
  }
}, { role: ACCESS.fieldsEdit });

/** DELETE /api/settings/field-sets/[id] → { id, archived: true }; 409 IN_USE while it is used. */
export const DELETE = withAuth<{ id: string }>(async (_req, { session, params: { id } }) => {
  try {
    return NextResponse.json(await deleteFieldSet(prisma, parseDbId(id), actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to delete the field set");
  }
}, { role: ACCESS.fieldsEdit });
