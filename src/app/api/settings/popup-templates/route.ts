import { NextResponse } from "next/server";
import { listTemplateSummaries } from "@/app/lib/popup-templates/store";

export const runtime = "nodejs";

/**
 * GET /api/settings/popup-templates — which station types have a popup template, with its base and
 * version (docs/popup-templates/PLAN.md §3.6), never the configs. Open to any signed-in user, like
 * every settings read. A failure is a real 500, never an empty list: an empty list would read as
 * "no station has a template" and open the code's popups.
 */
export async function GET() {
  try {
    return NextResponse.json(await listTemplateSummaries());
  } catch (error) {
    console.error("Error listing popup templates:", error);
    return NextResponse.json({ error: "Failed to list popup templates" }, { status: 500 });
  }
}
