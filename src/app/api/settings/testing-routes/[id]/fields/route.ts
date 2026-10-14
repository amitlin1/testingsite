import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse, getRouteFields, parsePathId } from "@/app/lib/station-fields/admin";

export const runtime = "nodejs";

/**
 * GET /api/settings/testing-routes/[id]/fields — the route's station-field config for the editor
 * (route-fields spec §3.2): draft, latest published version, issues, kits sharing the route.
 * Open to any signed-in user (middleware). A failure is a real 500, never an empty object: the
 * screen must not show a route as having no fields when they could not be read (artboard 11).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getRouteFields(prisma, parsePathId(id)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load route fields");
  }
}
