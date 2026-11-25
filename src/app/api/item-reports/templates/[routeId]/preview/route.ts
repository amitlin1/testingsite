import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ACCESS } from "@/lib/auth/roles";
import { loadRouteCatalog } from "@/app/lib/item-report/catalog";
import { previewTemplatePdf } from "@/app/lib/item-report/build";
import { loadReportSource } from "@/app/lib/item-report/source";
import { pdfResponse, readPreviewBody, withRouteId } from "@/app/lib/item-report/http";
import type { ReportVar } from "@/app/lib/item-report/types";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/templates/[routeId]/preview { template, item_id? }
 * The editor's "תצוגה מקדימה": the unsaved template as a PDF, filled with a
 * real item's data (item_id) or with the variables' own labels. Never stored.
 */
export const POST = withRouteId(async (req, { routeId }) => {
  try {
    const read = await readPreviewBody(req);
    if ("error" in read) return read.error;
    // With an item its own values print; only without one are the route's variables needed.
    let vars: ReportVar[] = [];
    if (read.itemId == null) {
      const catalog = await loadRouteCatalog(prisma, routeId);
      if (!catalog) return NextResponse.json({ error: "Route not found" }, { status: 404 });
      vars = catalog.vars;
    } else if (!(await prisma.testing_routes.findUnique({ where: { test_route_id: routeId }, select: { test_route_id: true } }))) {
      return NextResponse.json({ error: "Route not found" }, { status: 404 });
    }
    const src = read.itemId != null ? await loadReportSource(read.itemId) : null;
    if (read.itemId != null && !src) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return pdfResponse(await previewTemplatePdf(read.template, { src, vars }), "preview.pdf");
  } catch (e) {
    return errorResponse(e, "Failed to render the preview");
  }
}, { role: ACCESS.reportTemplate });
