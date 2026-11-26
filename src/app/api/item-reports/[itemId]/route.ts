import { NextResponse } from "next/server";
import { getItemReport, getItemReportHtml } from "@/app/lib/item-report/lifecycle";
import { pdfResponse, withItemId } from "@/app/lib/item-report/http";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/item-reports/[itemId] — the item's report as a PDF (docs/features/ITEM_REPORTS.md).
 * The final copy of a finished item is served byte-for-byte from MinIO; an item
 * still on its route (or waiting for the signature) gets a live draft.
 * ?html=1 — the live HTML instead (no Chromium), for the signing dialog's preview.
 * 204 when the item's route has no report template.
 */
export const GET = withItemId(async (req, { itemId }) => {
  try {
    if (new URL(req.url).searchParams.get("html") === "1") {
      const html = await getItemReportHtml(itemId);
      if (html == null) return new NextResponse(null, { status: 204 });
      return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
    }
    const doc = await getItemReport(itemId);
    if (doc.kind === "not_found") return NextResponse.json({ error: "Item not found" }, { status: 404 });
    if (doc.kind === "no_template") return new NextResponse(null, { status: 204 });
    return pdfResponse(doc.bytes, doc.filename, { "X-Report-Final": doc.final ? "1" : "0", "X-Report-Version": String(doc.version) });
  } catch (e) {
    return errorResponse(e, "Failed to produce the report");
  }
});
