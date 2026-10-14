import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { adminFieldsErrorResponse, parsePathId } from "@/app/lib/station-fields/admin";
import { optionListUsage } from "@/app/lib/station-fields/library";

export const runtime = "nodejs";

/**
 * GET /api/settings/option-lists/[id]/usage — every field linked to the list, in a draft or a
 * latest published version, with its chip labels (LibraryUseJson[]). Open to any signed-in user.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await optionListUsage(prisma, parsePathId(id)));
  } catch (error) {
    return adminFieldsErrorResponse(error, "Failed to load the option list's usage");
  }
}
