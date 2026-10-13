import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { adminFieldsErrorResponse, previewPublish, readJsonObject } from "@/app/lib/station-fields/admin";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

/**
 * POST /api/settings/testing-routes/fields/publish-preview — what publishing these routes' drafts
 * would do (spec §3.4.2, artboard 10). Body { route_ids, context_kit_id? } → PublishImpact;
 * 422 LINT_ERRORS with `issues` while a draft has errors. Read-only.
 */
export const POST = withAuth(async (req) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await previewPublish(prisma, body));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to preview the publish");
  }
}, { role: FIELDS_EDIT_ROLES });
