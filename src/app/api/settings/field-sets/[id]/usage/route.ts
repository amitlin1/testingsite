import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse, parsePathId } from "@/app/lib/station-fields/admin";
import { fieldSetUsage } from "@/app/lib/station-fields/library";

export const runtime = "nodejs";

/**
 * GET /api/settings/field-sets/[id]/usage — every cell holding the set's fields, in a draft or a
 * latest published version, with the version it holds and its chip labels (LibraryUseJson[]).
 * Open to any signed-in user.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await fieldSetUsage(prisma, parsePathId(id)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load the field set's usage");
  }
}
