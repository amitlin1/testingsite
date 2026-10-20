import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { loadRouteCatalog } from "@/app/lib/item-report/catalog";
import { isTemplate } from "@/app/lib/item-report/template-utils";
import { REPORT_TEMPLATE_ROLES } from "@/app/lib/item-report/roles";
import { actorOf, parseRouteId, type RouteCtx } from "@/app/lib/item-report/http";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A template is a Puck document; anything bigger than this is not one somebody drew. */
const MAX_TEMPLATE_BYTES = 1024 * 1024;

/**
 * GET /api/item-reports/templates/[routeId] — the route's report template and
 * what it can bind: { route, template | null, updated_at, updated_by_name, vars, steps }.
 */
export const GET = withAuth(async (_req, _ctx, routeCtx) => {
  const { routeId: raw } = await (routeCtx as RouteCtx<"routeId">).params;
  const routeId = parseRouteId(raw);
  if (routeId == null) return NextResponse.json({ error: "Bad route id" }, { status: 400 });
  try {
    const catalog = await loadRouteCatalog(prisma, routeId);
    if (!catalog) return NextResponse.json({ error: "Route not found" }, { status: 404 });
    const row = await prisma.report_templates.findUnique({ where: { test_route_id: routeId } });
    return NextResponse.json({
      ...catalog,
      template: row?.template ?? null,
      updated_at: row?.updated_at.toISOString() ?? null,
      updated_by_name: row?.updated_by_name ?? null,
    });
  } catch (e) {
    console.error(`[item-report] template GET ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to load the report template" }, { status: 500 });
  }
});

/** PUT { template } — save the route's template. Already-final reports keep their stored copy. */
export const PUT = withAuth(async (req, { session }, routeCtx) => {
  const { routeId: raw } = await (routeCtx as RouteCtx<"routeId">).params;
  const routeId = parseRouteId(raw);
  if (routeId == null) return NextResponse.json({ error: "Bad route id" }, { status: 400 });
  const text = await req.text();
  if (text.length > MAX_TEMPLATE_BYTES) return NextResponse.json({ error: "Template too large" }, { status: 413 });
  let body: { template?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isTemplate(body.template)) return NextResponse.json({ error: "template must be a Puck document" }, { status: 400 });
  try {
    const route = await prisma.testing_routes.findUnique({ where: { test_route_id: routeId }, select: { test_route_id: true } });
    if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });
    const actor = actorOf(session);
    const template = body.template as unknown as Prisma.InputJsonValue;
    const row = await prisma.report_templates.upsert({
      where: { test_route_id: routeId },
      create: { test_route_id: routeId, template, updated_by: actor.username, updated_by_name: actor.name },
      update: { template, updated_by: actor.username, updated_by_name: actor.name },
    });
    return NextResponse.json({ updated_at: row.updated_at.toISOString(), updated_by_name: row.updated_by_name });
  } catch (e) {
    console.error(`[item-report] template PUT ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to save the report template" }, { status: 500 });
  }
}, { role: REPORT_TEMPLATE_ROLES });

/** DELETE — the route has no report any more (items on it get none; final copies stay). */
export const DELETE = withAuth(async (_req, _ctx, routeCtx) => {
  const { routeId: raw } = await (routeCtx as RouteCtx<"routeId">).params;
  const routeId = parseRouteId(raw);
  if (routeId == null) return NextResponse.json({ error: "Bad route id" }, { status: 400 });
  await prisma.report_templates.deleteMany({ where: { test_route_id: routeId } });
  return new NextResponse(null, { status: 204 });
}, { role: REPORT_TEMPLATE_ROLES });
