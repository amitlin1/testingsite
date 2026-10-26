import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { actorFromSession, parsePathId } from "@/app/lib/station-fields/admin";
import { FIELDS_EDIT_ROLES } from "@/app/lib/station-fields/roles";
import { TemplateStoreError, deleteTemplate, getTemplate, parseSaveInput, saveTemplate } from "@/app/lib/popup-templates/store";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ typeId: string }> };

const INT4_MAX = 2147483647;

/** The station type id of the path; 400 INVALID_ID for anything that cannot name one. */
async function typeIdOf(routeCtx: unknown): Promise<number> {
  const { typeId } = await (routeCtx as RouteCtx).params;
  const id = parsePathId(typeId);
  if (!Number.isSafeInteger(id) || id < 1 || id > INT4_MAX) throw new TemplateStoreError(400, "INVALID_ID", "מזהה סוג העמדה אינו תקין");
  return id;
}

function errorResponse(error: unknown, what: string) {
  if (error instanceof TemplateStoreError) return NextResponse.json(error.body, { status: error.status });
  console.error(`Error: ${what}`, error);
  return NextResponse.json({ error: what }, { status: 500 });
}

/**
 * /api/settings/popup-templates/[typeId] — a station type's popup template
 * (docs/popup-templates/PLAN.md §3, step 1.2).
 *   GET     → PopupTemplateJson | 404 TEMPLATE_NOT_FOUND. Open to any signed-in user: the testing
 *             page reads it when the popup opens.
 *   PUT     { base, config, expected_version } → the saved template (a new version). Refusals in
 *             store.ts saveTemplate. The routes page's roles.
 *   DELETE  → 204: the type opens the code's popup again. The routes page's roles.
 */
export async function GET(_req: Request, routeCtx: unknown) {
  try {
    const tpl = await getTemplate(await typeIdOf(routeCtx));
    if (!tpl) return NextResponse.json({ error: "לסוג העמדה אין תבנית", code: "TEMPLATE_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(tpl);
  } catch (error) {
    return errorResponse(error, "Failed to read the popup template");
  }
}

export const PUT = withAuth(async (req, { session }, routeCtx) => {
  try {
    const typeId = await typeIdOf(routeCtx);
    const body = await req.json().catch(() => null);
    return NextResponse.json(await saveTemplate(typeId, parseSaveInput(body), actorFromSession(session)));
  } catch (error) {
    return errorResponse(error, "Failed to save the popup template");
  }
}, { role: FIELDS_EDIT_ROLES });

export const DELETE = withAuth(async (_req, _ctx, routeCtx) => {
  try {
    await deleteTemplate(await typeIdOf(routeCtx));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Failed to delete the popup template");
  }
}, { role: FIELDS_EDIT_ROLES });
