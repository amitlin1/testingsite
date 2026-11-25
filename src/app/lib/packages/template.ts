import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http/errors";
import { parseDbId } from "@/lib/http/request";
import { checkItemRouteAgainstPackage, checkPackageRoute, loadPackageLevelTypeIds, loadRouteShape, type RouteShape } from "./route-rules";
import {
  DEFAULT_ROUTE_NUMBER, KIT_HAS_NO_ROUTE, boxRouteNumber,
  type PackageTypeSummary, type TemplateDescription, type TemplateLineView,
} from "./template-wire";

/**
 * The package template on the server: the settings list of package types,
 * the contents editor's read and save. Route-shape problems are WARNINGS here
 * (a template may be saved before its routes are drawn) and hard refusals at
 * intake (lifecycle.ts).
 */

/**
 * Does an item route fit the kit's routes? The first kit route it does not
 * fit, with the reason, or null. Kit routes that are not package routes are
 * skipped: they earn their own warning.
 */
export function kitRouteFit(
  kitShapes: RouteShape[],
  itemShape: RouteShape | null,
  packageLevel: Set<number>,
  routeNumber: number,
): { kit: RouteShape; problem: string } | null {
  for (const kit of kitShapes) {
    if (checkPackageRoute(kit, packageLevel, kit.routeNumber)) continue;
    const problem = checkItemRouteAgainstPackage(itemShape, kit, packageLevel, routeNumber);
    if (problem) return { kit, problem };
  }
  return null;
}

/** GET /api/settings/package-types: every package type with the size of its
 *  template and the first route problem — judged against the type's default
 *  route only (the contents editor judges every kit route). */
export async function packageTypeSummaries(): Promise<PackageTypeSummary[]> {
  const types = await prisma.item_types.findMany({
    where: { is_package: true },
    orderBy: { item_type_desc: "asc" },
    include: { package_contents: { select: { item_type_id: true, quantity: true, route_number: true } } },
  });
  const packageLevel = await loadPackageLevelTypeIds(prisma);
  const routes = await prisma.testing_routes.findMany({ select: { item_type_id: true, route_number: true, route_steps: true } });
  const routeMap = new Map(routes.map((r) => [`${r.item_type_id}:${r.route_number}`, r.route_steps ?? []]));
  const shapeOf = (itemTypeId: number, routeNumber: number): RouteShape | null => {
    const steps = routeMap.get(`${itemTypeId}:${routeNumber}`);
    return steps ? { itemTypeId, routeNumber, steps } : null;
  };
  const packageCounts = await prisma.items.groupBy({
    by: ["item_type_id"],
    where: { package_id: null, item_type_id: { in: types.map((t) => t.item_type_id) } },
    _count: { _all: true },
  });
  const countByType = new Map(packageCounts.map((c) => [c.item_type_id, c._count._all]));

  return types.map((t) => {
    const lines = t.package_contents;
    const pkgRouteNo = boxRouteNumber(null, t.default_route_number);
    const pkgShape = shapeOf(t.item_type_id, pkgRouteNo);
    let warning = checkPackageRoute(pkgShape, packageLevel, pkgRouteNo);
    if (!warning && pkgShape) {
      for (const l of lines) {
        const misfit = kitRouteFit([pkgShape], shapeOf(l.item_type_id, l.route_number), packageLevel, l.route_number);
        if (misfit) { warning = misfit.problem; break; }
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
}

/** The package type the contents routes act on: 404 when missing, 400 when not a package type. */
export async function loadPackageTypeOrRefuse(rawId: string) {
  const id = parseDbId(rawId);
  if (id === null) throw new HttpError(404, "סוג הפריט לא נמצא");
  const type = await prisma.item_types.findUnique({
    where: { item_type_id: id },
    select: { item_type_id: true, item_type_desc: true, is_package: true, default_route_number: true },
  });
  if (!type) throw new HttpError(404, "סוג הפריט לא נמצא");
  if (!type.is_package) throw new HttpError(400, "סוג הפריט אינו סוג מארז");
  return type;
}

/** The template of one package type, each line warned against every kit route. */
export async function describeTemplate(packageTypeId: number): Promise<TemplateDescription> {
  const lines = await prisma.package_contents.findMany({
    where: { package_type_id: packageTypeId },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    include: { item_type: { select: { item_type_desc: true } } },
  });

  const packageLevel = await loadPackageLevelTypeIds(prisma);
  const packageRoutes = await prisma.testing_routes.findMany({
    where: { item_type_id: packageTypeId },
    orderBy: { route_number: "asc" },
    select: { route_number: true, route_steps: true },
  });
  const kitShapes: RouteShape[] = packageRoutes.map((r) => ({ itemTypeId: packageTypeId, routeNumber: r.route_number, steps: r.route_steps ?? [] }));
  const packageRouteWarnings = kitShapes.length === 0
    ? [KIT_HAS_NO_ROUTE]
    : kitShapes.map((s) => checkPackageRoute(s, packageLevel, s.routeNumber)).filter((w): w is string => w != null);

  const out: TemplateLineView[] = [];
  for (const l of lines) {
    const itemShape = await loadRouteShape(prisma, l.item_type_id, l.route_number);
    out.push({
      id: l.id,
      item_type_id: l.item_type_id,
      item_type_desc: l.item_type.item_type_desc.trim(),
      quantity: l.quantity,
      route_number: l.route_number,
      sort_order: l.sort_order,
      route_warning: kitRouteFit(kitShapes, itemShape, packageLevel, l.route_number)?.problem ?? null,
    });
  }

  const type = await prisma.item_types.findUnique({
    where: { item_type_id: packageTypeId },
    select: { item_type_desc: true, default_route_number: true },
  });
  return {
    package_type_id: packageTypeId,
    item_type_desc: type?.item_type_desc.trim() ?? "",
    default_route_number: type?.default_route_number ?? null,
    total_items: out.reduce((n, l) => n + l.quantity, 0),
    package_route_warnings: packageRouteWarnings,
    lines: out,
  };
}

export type TemplateLineInput = { item_type_id: number; quantity: number; route_number: number; sort_order: number };

/** The lines a PUT sent, checked; a refusal names the line (`lineIndex`). A
 *  line names an item type, its quantity and its route — nothing about the
 *  item itself: makat / model / manufacturer come from the box's shipment
 *  line at intake. */
export async function readTemplateLines(raw: unknown): Promise<TemplateLineInput[]> {
  if (!Array.isArray(raw)) throw new HttpError(400, "lines חייב להיות מערך");
  const refuse = (i: number, why: string) => new HttpError(400, `שורה ${i + 1}: ${why}`, { extra: { lineIndex: i } });
  const lines: TemplateLineInput[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i] ?? {};
    const itemTypeId = Number(l.item_type_id);
    const quantity = Number(l.quantity);
    const routeNumber = l.route_number == null || l.route_number === "" ? DEFAULT_ROUTE_NUMBER : Number(l.route_number);
    if (!Number.isInteger(itemTypeId)) throw refuse(i, "חסר סוג פריט");
    if (!Number.isInteger(quantity) || quantity < 1) throw refuse(i, "הכמות חייבת להיות מספר שלם גדול מאפס");
    if (!Number.isInteger(routeNumber) || routeNumber < 1) throw refuse(i, "מספר מסלול לא תקין");
    if (seen.has(itemTypeId)) throw refuse(i, "סוג הפריט מופיע פעמיים");
    seen.add(itemTypeId);
    lines.push({
      item_type_id: itemTypeId,
      quantity,
      route_number: routeNumber,
      sort_order: Number.isInteger(Number(l.sort_order)) ? Number(l.sort_order) : i,
    });
  }
  if (lines.length > 0) {
    const types = await prisma.item_types.findMany({
      where: { item_type_id: { in: lines.map((l) => l.item_type_id) } },
      select: { item_type_id: true, item_type_desc: true, is_package: true },
    });
    const byId = new Map(types.map((t) => [t.item_type_id, t]));
    for (let i = 0; i < lines.length; i++) {
      const t = byId.get(lines[i].item_type_id);
      if (!t) throw refuse(i, "סוג הפריט לא נמצא");
      if (t.is_package) throw refuse(i, `${t.item_type_desc.trim()} הוא סוג מארז — אין קינון של מארזים`);
    }
  }
  return lines;
}

/** Replaces the template; the type's default route travels with it (one
 *  save button on the screen) — undefined leaves it as it is. */
export async function saveTemplate(packageTypeId: number, lines: TemplateLineInput[], defaultRoute: number | null | undefined): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (defaultRoute !== undefined) {
      await tx.item_types.update({ where: { item_type_id: packageTypeId }, data: { default_route_number: defaultRoute } });
    }
    await tx.package_contents.deleteMany({ where: { package_type_id: packageTypeId } });
    if (lines.length > 0) {
      await tx.package_contents.createMany({ data: lines.map((l) => ({ package_type_id: packageTypeId, ...l })) });
    }
  });
}
