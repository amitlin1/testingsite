import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { discardFieldsDraft, saveFieldsDraft } from "@/app/lib/station-fields/admin";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * PUT /api/settings/testing-routes/[id]/fields/draft — autosave of the route's field-config draft
 * (spec §3.2, §3.4.1). Body { config, base_rev } → { draft_rev, draft_updated_at, issues }.
 */
export const PUT = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await saveFieldsDraft(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to save the fields draft");
  }
}, { role: ACCESS.fieldsEdit });

/**
 * DELETE /api/settings/testing-routes/[id]/fields/draft — "ביטול הטיוטה". Body { base_rev } →
 * { draft_rev }.
 */
export const DELETE = withAuth<{ id: string }>(async (req, { session, params: { id } }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await discardFieldsDraft(prisma, parseDbId(id), body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to discard the fields draft");
  }
}, { role: ACCESS.fieldsEdit });
