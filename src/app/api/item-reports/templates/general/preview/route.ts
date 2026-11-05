import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { generalCatalog } from "@/app/lib/item-report/catalog";
import { previewTemplatePdf } from "@/app/lib/item-report/generate";
import { isTemplate } from "@/app/lib/item-report/template-utils";
import { REPORT_TEMPLATE_ROLES } from "@/app/lib/item-report/roles";
import { parseItemId, pdfResponse } from "@/app/lib/item-report/http";
import type { Data } from "@measured/puck";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/templates/general/preview { template, item_id? }
 * The general template's "תצוגה מקדימה": the unsaved document as a PDF, with any item's data —
 * of any route — or with the variables' own labels. Never stored.
 */
export const POST = withAuth(async (req) => {
  const body = (await req.json().catch(() => null)) as { template?: unknown; item_id?: unknown } | null;
  if (!isTemplate(body?.template)) return NextResponse.json({ error: "template must be a Puck document" }, { status: 400 });
  const itemId = body?.item_id != null && body.item_id !== "" ? parseItemId(String(body.item_id)) : null;
  if (body?.item_id != null && body.item_id !== "" && itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
  try {
    const pdf = await previewTemplatePdf(body!.template as Data, { itemId, sample: { vars: generalCatalog().vars } });
    if (!pdf) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    return pdfResponse(pdf, "preview.pdf");
  } catch (e) {
    console.error("[item-report] general preview failed", e);
    return NextResponse.json({ error: "Failed to render the preview" }, { status: 500 });
  }
}, { role: REPORT_TEMPLATE_ROLES });
