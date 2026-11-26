import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ACCESS } from "@/lib/auth/roles";
import { loadRouteCatalog } from "@/app/lib/item-report/catalog";
import { readTemplateBody, templateActor, withRouteId } from "@/app/lib/item-report/http";
import type { RouteTemplateJson, TemplateSavedJson } from "@/app/lib/item-report/contract";
import type { Prisma } from "@prisma/client";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/item-reports/templates/[routeId] — the route's report template and what it can bind. */
export const GET = withRouteId(async (_req, { routeId }) => {
  try {
    const catalog = await loadRouteCatalog(prisma, routeId);
    if (!catalog) return NextResponse.json({ error: "Route not found" }, { status: 404 });
    const row = await prisma.report_templates.findUnique({ where: { test_route_id: routeId } });
    const body: RouteTemplateJson = {
      ...catalog,
      template: (row?.template ?? null) as RouteTemplateJson["template"],
      updated_at: row?.updated_at.toISOString() ?? null,
      updated_by_name: row?.updated_by_name ?? null,
    };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse(e, "Failed to load the report template");
  }
});

/** PUT { template } — save the route's template. Already-final reports keep their stored copy. */
export const PUT = withRouteId(async (req, { session, routeId }) => {
  const read = await readTemplateBody(req);
  if ("error" in read) return read.error;
  try {
    const route = await prisma.testing_routes.findUnique({ where: { test_route_id: routeId }, select: { test_route_id: true } });
    if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });
    const template = read.template as unknown as Prisma.InputJsonValue;
    const actor = templateActor(session);
    const row = await prisma.report_templates.upsert({
      where: { test_route_id: routeId },
      create: { test_route_id: routeId, template, ...actor },
      update: { template, ...actor },
    });
    const body: TemplateSavedJson = { updated_at: row.updated_at.toISOString(), updated_by_name: row.updated_by_name };
    return NextResponse.json(body);
  } catch (e) {
    return errorResponse(e, "Failed to save the report template");
  }
}, { perm: ACCESS.reportTemplate });

/** DELETE — the route goes back to the general template (final copies stay). */
export const DELETE = withRouteId(async (_req, { routeId }) => {
  await prisma.report_templates.deleteMany({ where: { test_route_id: routeId } });
  return new NextResponse(null, { status: 204 });
}, { perm: ACCESS.reportTemplate });
