import { NextResponse } from "next/server";
import { ACCESS, can } from "@/lib/auth/roles";
import { getReportStatus } from "@/app/lib/item-report/lifecycle";
import { withItemId } from "@/app/lib/item-report/http";
import type { ReportStatusResponse } from "@/app/lib/item-report/contract";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/item-reports/[itemId]/status → ReportStatusResponse. */
export const GET = withItemId(async (_req, { session, itemId }) => {
  try {
    const status = await getReportStatus(itemId);
    if (!status) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const roles = session.roles ?? [];
    const body: ReportStatusResponse = {
      ...status,
      canSign: can(roles, ACCESS.reportFinalSign),
      canSignClosing: can(roles, ACCESS.reportClosingSign),
    };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse(e, "Failed to read the report status");
  }
});
