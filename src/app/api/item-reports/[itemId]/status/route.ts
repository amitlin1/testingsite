import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { hasAnyRole } from "@/lib/auth/roles";
import { getReportStatus } from "@/app/lib/item-report/generate";
import { REPORT_CLOSING_SIGN_ROLES, REPORT_FINAL_SIGN_ROLES } from "@/app/lib/item-report/roles";
import { parseItemId, type RouteCtx } from "@/app/lib/item-report/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/item-reports/[itemId]/status → ReportStatus +
 *   canSign         this user may give the final signature (the history page's button);
 *   canSignClosing  this user may sign at the kit's closing (the closing's "חתימה על הדוחות").
 */
export const GET = withAuth(async (_req, { session }, routeCtx) => {
  const { itemId: raw } = await (routeCtx as RouteCtx<"itemId">).params;
  const itemId = parseItemId(raw);
  if (itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
  try {
    const status = await getReportStatus(itemId);
    if (!status) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const roles = session.roles ?? [];
    return NextResponse.json({
      ...status,
      canSign: hasAnyRole(roles, REPORT_FINAL_SIGN_ROLES),
      canSignClosing: hasAnyRole(roles, REPORT_CLOSING_SIGN_ROLES),
    });
  } catch (e) {
    console.error(`[item-report] status ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to read the report status" }, { status: 500 });
  }
});
