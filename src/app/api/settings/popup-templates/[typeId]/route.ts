import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { actorFromSession } from "@/lib/auth/identity";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { parseDbId, readJsonObject } from "@/lib/http/request";
import { deleteTemplate, getTemplate, parseSaveInput, saveTemplate } from "@/app/lib/popup-templates/store";

export const runtime = "nodejs";

/** The station type id of the path; 400 INVALID_ID for anything that cannot name one. */
function typeIdOf(typeId: string): number {
  const id = parseDbId(typeId);
  if (id === null) throw new HttpError(400, "מזהה סוג העמדה אינו תקין", { code: "INVALID_ID" });
  return id;
}

/**
 * /api/settings/popup-templates/[typeId] — a station type's popup template
 * (docs/features/popup-templates/PLAN.md §3, step 1.2).
 *   GET     → PopupTemplateJson | 404 TEMPLATE_NOT_FOUND. Open to any signed-in user: the testing
 *             page reads it when the popup opens.
 *   PUT     { base, config, expected_version } → the saved template (a new version). Refusals in
 *             store.ts saveTemplate.
 *   DELETE  → 204: the type opens the code's popup again.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ typeId: string }> }) {
  try {
    const tpl = await getTemplate(typeIdOf((await params).typeId));
    if (!tpl) throw new HttpError(404, "לסוג העמדה אין תבנית", { code: "TEMPLATE_NOT_FOUND" });
    return NextResponse.json(tpl);
  } catch (error) {
    return errorResponse(error, "Failed to read the popup template");
  }
}

export const PUT = withAuth<{ typeId: string }>(async (req, { session, params }) => {
  try {
    const typeId = typeIdOf(params.typeId);
    const body = await readJsonObject(req, "גוף הבקשה אינו אובייקט");
    return NextResponse.json(await saveTemplate(typeId, parseSaveInput(body), actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to save the popup template");
  }
}, { role: ACCESS.popupTemplatesSettings });

export const DELETE = withAuth<{ typeId: string }>(async (_req, { params }) => {
  try {
    await deleteTemplate(typeIdOf(params.typeId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Failed to delete the popup template");
  }
}, { role: ACCESS.popupTemplatesSettings });
