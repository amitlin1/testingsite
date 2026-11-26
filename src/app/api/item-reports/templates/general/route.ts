import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { countGeneralRoutes, generalCatalog } from "@/app/lib/item-report/catalog";
import { templateHasContent } from "@/app/lib/item-report/template-utils";
import { readTemplateBody, templateActor } from "@/app/lib/item-report/http";
import { GENERAL_TEMPLATE_ID } from "@/app/lib/item-report/source";
import type { GeneralTemplateJson, TemplateSavedJson } from "@/app/lib/item-report/contract";
import type { Prisma } from "@prisma/client";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/item-reports/templates/general — the general template (docs/features/ITEM_REPORTS.md), what
 * it can bind (the item's and the report's variables; no step), and how many item routes use it.
 */
export const GET = withAuth(async () => {
  try {
    const [row, routes] = await Promise.all([
      prisma.report_general_template.findUnique({ where: { id: GENERAL_TEMPLATE_ID } }),
      countGeneralRoutes(prisma),
    ]);
    const body: GeneralTemplateJson = {
      ...generalCatalog(),
      template: (row?.template ?? null) as GeneralTemplateJson["template"],
      updated_at: row?.updated_at.toISOString() ?? null,
      updated_by_name: row?.updated_by_name ?? null,
      routes,
    };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse(e, "Failed to load the general template");
  }
});

/** PUT { template } — save it. It has no DELETE, and is never empty: every item gets a report.
 *  Reports already final keep their stored copy. */
export const PUT = withAuth(async (req, { session }) => {
  const read = await readTemplateBody(req);
  if ("error" in read) return read.error;
  if (!templateHasContent(read.template)) return NextResponse.json({ error: "התבנית הכללית לא יכולה להיות ריקה", code: "EMPTY" }, { status: 400 });
  try {
    const template = read.template as unknown as Prisma.InputJsonValue;
    const actor = templateActor(session);
    const row = await prisma.report_general_template.upsert({
      where: { id: GENERAL_TEMPLATE_ID },
      create: { id: GENERAL_TEMPLATE_ID, template, ...actor },
      update: { template, ...actor },
    });
    const body: TemplateSavedJson = { updated_at: row.updated_at.toISOString(), updated_by_name: row.updated_by_name };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse(e, "Failed to save the general template");
  }
}, { perm: ACCESS.reportTemplate });
