import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, readJsonObject } from "@/app/lib/station-fields/admin";
import { createFieldSet, listFieldSets } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

/**
 * GET /api/settings/field-sets — the field sets (artboard 8), archived ones left out, each with
 * usage { cells, outdated } counted over every route's draft and latest published version (spec
 * §3.2). Open to any signed-in user (middleware). A failure is a real 500, never [].
 */
export async function GET() {
  try {
    return NextResponse.json(await listFieldSets(prisma));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load field sets");
  }
}

/** POST /api/settings/field-sets — { name, fields } → 201 with the new set (version 1). */
export const POST = withAuth(async (req, { session }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await createFieldSet(prisma, body, actorFromSession(session)), { status: 201 });
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to create the field set");
  }
}, { role: FIELDS_EDIT_ROLES });
