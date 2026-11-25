import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { propagateFieldSet } from "@/app/lib/station-fields/library";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/field-sets/[id]/propagate — "עדכן את כולם ({n})" (artboard 8): the outdated
 * cells (all, or those holding a target's field) take the set's current fields in their routes'
 * DRAFTS; nothing is published. Body { targets?: {route_id, step_uid, field_id}[] } →
 * { updated_drafts }.
 */
export const POST = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await propagateFieldSet(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to propagate the field set");
  }
}, { role: ACCESS.fieldsEdit });
