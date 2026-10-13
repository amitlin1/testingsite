import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, publishFields, readJsonObject } from "@/app/lib/station-fields/admin";
import { PUBLISH_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/testing-routes/fields/publish — "פרסם גרסה N" (spec §3.4.3, artboard 10).
 * Body { route_ids, base_revs, apply_mode, note? } → { publish_batch, versions, bumped_items }.
 * Roles: PUBLISH_ROLES (open decision §10.2-1).
 */
export const POST = withAuth(async (req, { session }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await publishFields(prisma, body, actorFromSession(session)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to publish the fields");
  }
}, { role: PUBLISH_ROLES });
