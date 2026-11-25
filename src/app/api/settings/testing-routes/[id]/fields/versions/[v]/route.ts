import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getFieldVersion } from "@/app/lib/station-fields/admin";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId } from "@/lib/http/request";

export const runtime = "nodejs";

/**
 * GET /api/settings/testing-routes/[id]/fields/versions/[v] — one published version, whole
 * (spec §3.2, §3.4.4). Open to any signed-in user (middleware).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; v: string }> }) {
  try {
    const { id, v } = await params;
    return NextResponse.json(await getFieldVersion(prisma, parseDbId(id), parseDbId(v)));
  } catch (error) {
    return errorResponse(error, "Failed to load the field version");
  }
}
