import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { errorResponse } from "@/lib/http/errors";
import { packageIdParam } from "@/app/lib/packages/http";
import { getPackageReport } from "@/app/lib/item-report/lifecycle";
import { pdfResponse } from "@/app/lib/item-report/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/packages/[id]/report — the kit's combined report: every item's report, in the box's
 * order, in one PDF (docs/features/ITEM_REPORTS.md "דוח מאוחד למארז"). Rendered live, never stored.
 * 204 when no item in the box has a report.
 */
export const GET = withAuth<{ id: string }>(async (_req, { params }) => {
  try {
    const doc = await getPackageReport(packageIdParam(params.id));
    if (doc.kind === "not_found") return NextResponse.json({ error: "המארז לא נמצא" }, { status: 404 });
    if (doc.kind === "not_a_package") return NextResponse.json({ error: "המזהה אינו של מארז" }, { status: 400 });
    if (doc.kind === "no_reports") return new NextResponse(null, { status: 204 });
    return pdfResponse(doc.bytes, doc.filename, { "X-Report-Items": String(doc.items), "X-Report-Drafts": String(doc.drafts) });
  } catch (e) {
    return errorResponse(e, "הפקת הדוח המאוחד נכשלה");
  }
});
