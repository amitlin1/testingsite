import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { generalCatalog } from "@/app/lib/item-report/catalog";
import { previewTemplatePdf } from "@/app/lib/item-report/build";
import { loadReportSource } from "@/app/lib/item-report/source";
import { pdfResponse, readPreviewBody } from "@/app/lib/item-report/http";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/templates/general/preview { template, item_id? }
 * The general template's "תצוגה מקדימה": the unsaved document as a PDF, with any item's data —
 * of any route — or with the variables' own labels. Never stored.
 */
export const POST = withAuth(async (req) => {
  try {
    const read = await readPreviewBody(req);
    if ("error" in read) return read.error;
    const src = read.itemId != null ? await loadReportSource(read.itemId) : null;
    if (read.itemId != null && !src) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return pdfResponse(await previewTemplatePdf(read.template, { src, vars: generalCatalog().vars }), "preview.pdf");
  } catch (e) {
    return errorResponse(e, "Failed to render the preview");
  }
}, { role: ACCESS.reportTemplate });
