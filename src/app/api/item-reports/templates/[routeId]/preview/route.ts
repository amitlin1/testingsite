import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { loadRouteCatalog } from "@/app/lib/item-report/catalog";
import { previewTemplatePdf } from "@/app/lib/item-report/generate";
import { isTemplate } from "@/app/lib/item-report/template-utils";
import { REPORT_TEMPLATE_ROLES } from "@/app/lib/item-report/roles";
import { parseItemId, parseRouteId, pdfResponse, type RouteCtx } from "@/app/lib/item-report/http";
import type { Data } from "@measured/puck";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/templates/[routeId]/preview { template, item_id? }
 * The editor's "תצוגה מקדימה": the unsaved template as a PDF, filled with a
 * real item's data (item_id) or with the variables' own labels. Never stored.
 */
export const POST = withAuth(async (req, _ctx, routeCtx) => {
  const { routeId: raw } = await (routeCtx as RouteCtx<"routeId">).params;
  const routeId = parseRouteId(raw);
  if (routeId == null) return NextResponse.json({ error: "Bad route id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { template?: unknown; item_id?: unknown } | null;
  if (!isTemplate(body?.template)) return NextResponse.json({ error: "template must be a Puck document" }, { status: 400 });
  const itemId = body?.item_id != null && body.item_id !== "" ? parseItemId(String(body.item_id)) : null;
  if (body?.item_id != null && body.item_id !== "" && itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
  try {
    const catalog = await loadRouteCatalog(prisma, routeId);
    if (!catalog) return NextResponse.json({ error: "Route not found" }, { status: 404 });
    const pdf = await previewTemplatePdf(body!.template as Data, { itemId, sample: { vars: catalog.vars } });
    if (!pdf) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return pdfResponse(pdf, "preview.pdf");
  } catch (e) {
    console.error(`[item-report] preview ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to render the preview" }, { status: 500 });
  }
}, { role: REPORT_TEMPLATE_ROLES });
