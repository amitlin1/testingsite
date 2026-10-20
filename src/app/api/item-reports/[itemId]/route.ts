import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { getItemReport, getItemReportHtml } from "@/app/lib/item-report/generate";
import { parseItemId, pdfResponse, type RouteCtx } from "@/app/lib/item-report/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/item-reports/[itemId] — the item's report as a PDF (docs/ITEM_REPORTS.md).
 * The final copy of a finished item is served byte-for-byte from MinIO; an item
 * still on its route (or waiting for the signature) gets a live draft.
 * ?html=1 — the live HTML instead (no Chromium), for the signing dialog's preview.
 * 204 when the item's route has no report template.
 */
export const GET = withAuth(async (req, _ctx, routeCtx) => {
  const { itemId: raw } = await (routeCtx as RouteCtx<"itemId">).params;
  const itemId = parseItemId(raw);
  if (itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
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
    console.error(`[item-report] GET ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to produce the report" }, { status: 500 });
  }
});
