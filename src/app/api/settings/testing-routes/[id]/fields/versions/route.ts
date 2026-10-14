import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse, listFieldVersions, parsePathId } from "@/app/lib/station-fields/admin";

export const runtime = "nodejs";

/**
 * GET /api/settings/testing-routes/[id]/fields/versions — the route's published versions, newest
 * first ("היסטוריית גרסאות", spec §3.2). Open to any signed-in user (middleware).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await listFieldVersions(prisma, parsePathId(id)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load field versions");
  }
}
