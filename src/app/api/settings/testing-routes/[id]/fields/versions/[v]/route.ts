import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse, getFieldVersion, parsePathId } from "@/app/lib/station-fields/admin";

export const runtime = "nodejs";

/**
 * GET /api/settings/testing-routes/[id]/fields/versions/[v] — one published version, whole
 * (spec §3.2, §3.4.4). Open to any signed-in user (middleware).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; v: string }> }) {
  try {
    const { id, v } = await params;
    return NextResponse.json(await getFieldVersion(prisma, parsePathId(id), parsePathId(v)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load the field version");
  }
}
