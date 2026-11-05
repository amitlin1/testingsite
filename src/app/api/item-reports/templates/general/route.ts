import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { countGeneralRoutes, generalCatalog } from "@/app/lib/item-report/catalog";
import { isTemplate, templateHasContent } from "@/app/lib/item-report/template-utils";
import { REPORT_TEMPLATE_ROLES } from "@/app/lib/item-report/roles";
import { actorOf } from "@/app/lib/item-report/http";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A template is a Puck document; anything bigger than this is not one somebody drew. */
const MAX_TEMPLATE_BYTES = 1024 * 1024;

/**
 * GET /api/item-reports/templates/general — the general template (docs/ITEM_REPORTS.md), what
 * it can bind (the item's and the report's variables; no step), and how many item routes use it:
 * { template | null, updated_at, updated_by_name, vars, steps, routes }.
 */
export const GET = withAuth(async () => {
  try {
    const [row, routes] = await Promise.all([
      prisma.report_general_template.findUnique({ where: { id: 1 } }),
      countGeneralRoutes(prisma),
    ]);
    return NextResponse.json({
      ...generalCatalog(),
      template: row?.template ?? null,
      updated_at: row?.updated_at.toISOString() ?? null,
      updated_by_name: row?.updated_by_name ?? null,
      routes,
    });
  } catch (e) {
    console.error("[item-report] general template GET failed", e);
    return NextResponse.json({ error: "Failed to load the general template" }, { status: 500 });
  }
});

/** PUT { template } — save it. It has no DELETE, and is never empty: every item gets a report.
 *  Reports already final keep their stored copy. */
export const PUT = withAuth(async (req, { session }) => {
  const text = await req.text();
  if (text.length > MAX_TEMPLATE_BYTES) return NextResponse.json({ error: "Template too large" }, { status: 413 });
  let body: { template?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isTemplate(body.template)) return NextResponse.json({ error: "template must be a Puck document" }, { status: 400 });
  if (!templateHasContent(body.template)) return NextResponse.json({ error: "התבנית הכללית לא יכולה להיות ריקה", code: "EMPTY" }, { status: 400 });
  try {
    const actor = actorOf(session);
    const template = body.template as unknown as Prisma.InputJsonValue;
    const row = await prisma.report_general_template.upsert({
      where: { id: 1 },
      create: { id: 1, template, updated_by: actor.username, updated_by_name: actor.name },
      update: { template, updated_by: actor.username, updated_by_name: actor.name },
    });
    return NextResponse.json({ updated_at: row.updated_at.toISOString(), updated_by_name: row.updated_by_name });
  } catch (e) {
    console.error("[item-report] general template PUT failed", e);
    return NextResponse.json({ error: "Failed to save the general template" }, { status: 500 });
  }
}, { role: REPORT_TEMPLATE_ROLES });
