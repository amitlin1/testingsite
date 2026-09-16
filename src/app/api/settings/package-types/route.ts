import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  checkItemRouteAgainstPackage,
  checkPackageRoute,
  loadPackageLevelTypeIds,
  RouteShape,
} from "@/app/lib/packages/route-rules";

export const runtime = "nodejs";

/**
 * GET /api/settings/package-types — the list the "מארזים" settings screen
 * shows: every package type with the size of its template and whether the
 * routes involved obey the package rules (docs/packages/PLAN.md §4). Route
 * problems are reported, never enforced here; creation enforces them.
 */
export type PackageTypeSummary = {
  item_type_id: number;
  item_type_desc: string;
  default_route_number: number | null;
  /** Distinct item types in the template. */
  kinds: number;
  /** Sum of quantities in the template. */
  total_items: number;
  /** ok = every route fits; warn = at least one problem; none = no template. */
  health: "ok" | "warn" | "none";
  warning: string | null;
  /** Packages created from this type (for the delete guard on the screen). */
  package_count: number;
};

export async function GET() {
  try {
    const types = await prisma.item_types.findMany({
      where: { is_package: true },
      orderBy: { item_type_desc: "asc" },
      include: {
        package_contents: { select: { item_type_id: true, quantity: true, route_number: true } },

      },
    });
    const packageLevel = await loadPackageLevelTypeIds(prisma);
    const routes = await prisma.testing_routes.findMany({ select: { item_type_id: true, route_number: true, route_steps: true } });
    const routeMap = new Map(routes.map((r) => [`${r.item_type_id}:${r.route_number}`, r.route_steps ?? []]));
    const packageCounts = await prisma.items.groupBy({
      by: ["item_type_id"],
      where: { package_id: null, item_type_id: { in: types.map((t) => t.item_type_id) } },
      _count: { _all: true },
    });
    const countByType = new Map(packageCounts.map((c) => [c.item_type_id, c._count._all]));

    const out: PackageTypeSummary[] = types.map((t) => {
      const lines = t.package_contents;
      let warning: string | null = null;
      const pkgRouteNo = t.default_route_number ?? 1;
      const pkgSteps = routeMap.get(`${t.item_type_id}:${pkgRouteNo}`);
      const pkgShape: RouteShape | null = pkgSteps ? { itemTypeId: t.item_type_id, routeNumber: pkgRouteNo, steps: pkgSteps } : null;
      const pkgProblem = checkPackageRoute(pkgShape, packageLevel, pkgRouteNo);
      if (pkgProblem) warning = pkgProblem;
      else if (pkgShape) {
        for (const l of lines) {
          const steps = routeMap.get(`${l.item_type_id}:${l.route_number}`);
          const shape: RouteShape | null = steps ? { itemTypeId: l.item_type_id, routeNumber: l.route_number, steps } : null;
          const p = checkItemRouteAgainstPackage(shape, pkgShape, packageLevel, l.route_number);
          if (p) { warning = p; break; }
        }
      }
      return {
        item_type_id: t.item_type_id,
        item_type_desc: t.item_type_desc.trim(),
        default_route_number: t.default_route_number,
        kinds: lines.length,
        total_items: lines.reduce((n, l) => n + l.quantity, 0),
        health: lines.length === 0 ? "none" : warning ? "warn" : "ok",
        warning,
        package_count: countByType.get(t.item_type_id) ?? 0,
      };
    });

    return NextResponse.json(out);
  } catch (error) {
    console.error("Error listing package types:", error);
    return NextResponse.json([]);
  }
}
