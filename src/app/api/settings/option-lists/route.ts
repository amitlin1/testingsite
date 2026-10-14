import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, adminFieldsErrorResponse, readJsonObject } from "@/app/lib/station-fields/admin";
import { createOptionList, listOptionLists } from "@/app/lib/station-fields/library";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";

export const runtime = "nodejs";

/**
 * GET /api/settings/option-lists — the shared option lists (artboards 4 and 8), archived ones
 * left out, each with usage { fields, routes } counted over every route's draft and latest
 * published version (spec §3.2). Open to any signed-in user (middleware). A failure is a real 500,
 * never [].
 */
export async function GET() {
  try {
    return NextResponse.json(await listOptionLists(prisma));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load option lists");
  }
}

/** POST /api/settings/option-lists — { name, options } → 201 with the new list (version 1). */
export const POST = withAuth(async (req, { session }) => {
  try {
    const body = await readJsonObject(req);
    return NextResponse.json(await createOptionList(prisma, body, actorFromSession(session)), { status: 201 });
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to create the option list");
  }
}, { role: FIELDS_EDIT_ROLES });
