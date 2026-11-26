import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http/errors";
import { listTemplateSummaries } from "@/app/lib/popup-templates/store";

export const runtime = "nodejs";

/**
 * GET /api/settings/popup-templates — which station types have a popup template, with its base and
 * version (docs/features/popup-templates/PLAN.md §3.6), never the configs. Open to any signed-in user, like
 * every settings read. A failure is a real 500, never an empty list: an empty list would read as
 * "no station has a template" and open the code's popups.
 */
export async function GET() {
  try {
    return NextResponse.json(await listTemplateSummaries());
  } catch (error) {
    return errorResponse(error, "Failed to list popup templates");
  }
}
