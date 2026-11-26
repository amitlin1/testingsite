import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { publishFields } from "@/app/lib/station-fields/admin";
import { errorResponse } from "@/lib/http/errors";
import { actorFromSession } from "@/lib/auth/identity";
import { readJsonObject } from "@/lib/http/request";
import { ACCESS } from "@/lib/auth/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/testing-routes/fields/publish — "פרסם גרסה N" (spec §3.4.3, artboard 10).
 * Body { route_ids, base_revs, apply_mode, note? } → { publish_batch, versions, bumped_items }.
 * Roles: ACCESS.publish (open decision §10.2-1).
 */
export const POST = withAuth(async (req, { session }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await publishFields(prisma, body, actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to publish the fields");
  }
}, { perm: ACCESS.publish });
