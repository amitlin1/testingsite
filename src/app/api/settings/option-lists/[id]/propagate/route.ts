import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { propagateOptionList } from "@/app/lib/station-fields/library";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/option-lists/[id]/propagate — the linked fields (all, or `targets`) take the
 * list's current options in their routes' DRAFTS; nothing is published (artboard 4). Body
 * { targets?: {route_id, step_uid, field_id}[] } → { updated_drafts }.
 */
export const POST = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await propagateOptionList(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to propagate the option list");
  }
}, { role: ACCESS.fieldsEdit });
