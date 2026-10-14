import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse } from "@/app/lib/station-fields/admin";
import { buildFieldsContext, fieldsContextQuery } from "@/app/lib/station-fields/context";

export const runtime = "nodejs";

/**
 * GET /api/settings/testing-routes/fields-context?packageTypeId=&routeNumber= (a kit) or
 * ?itemTypeId=&routeNumber= (a single item route) — everything the fields map is built from
 * (route-fields spec §3.2, §5.17): FieldsContextJson (admin-types.ts). Open to any signed-in user
 * (middleware). A failure is a real 4xx/5xx, never an empty context: the screen must not show a
 * route as having no fields when it could not be read (artboard 11).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    return NextResponse.json(await buildFieldsContext(prisma, fieldsContextQuery(searchParams)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load the fields context");
  }
}
