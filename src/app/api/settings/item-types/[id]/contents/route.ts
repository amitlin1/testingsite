import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  checkItemRouteAgainstPackage,
  checkPackageRoute,
  loadPackageLevelTypeIds,
  loadRouteShape,
  RouteShape,
} from "@/app/lib/packages/route-rules";

export const runtime = "nodejs";

/**
 * Package contents (the template) of one package type —
 * docs/packages/PLAN.md §3. GET lists the lines with route warnings, PUT
 * replaces the whole list.
 *
 * Route-shape violations are WARNINGS here (a template may be saved before
 * its routes are drawn) and hard errors at package creation.
 */

type LineIn = {
  item_type_id: number;
  quantity: number;
  makat?: string | null;
  model?: string | null;
  manufacturer_name?: string | null;
  manufacturer_no?: string | null;
  manufacturer_sku?: string | null;
  route_number?: number | null;
  sort_order?: number | null;
};

async function loadPackageType(id: number) {
  return prisma.item_types.findUnique({
    where: { item_type_id: id },
    select: { item_type_id: true, item_type_desc: true, is_package: true, default_route_number: true },
  });
}

async function describe(packageTypeId: number) {
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

  const pkgShapes: RouteShape[] = packageRoutes.map((r) => ({
    itemTypeId: packageTypeId,
    routeNumber: r.route_number,
    steps: r.route_steps ?? [],
  }));

  const packageRouteWarnings = pkgShapes.length === 0
    ? ["לסוג המארז עדיין אין מסלול"]
    : pkgShapes
        .map((s) => checkPackageRoute(s, packageLevel, s.routeNumber))
        .filter((w): w is string => w != null);

  const out = [];
  for (const l of lines) {
    let routeWarning: string | null = null;
    const itemShape = await loadRouteShape(prisma, l.item_type_id, l.route_number);
    for (const pkg of pkgShapes) {
      if (checkPackageRoute(pkg, packageLevel, pkg.routeNumber)) continue; // reported above
      const w = checkItemRouteAgainstPackage(itemShape, pkg, packageLevel, l.route_number);
      if (w) { routeWarning = w; break; }
    }
    out.push({
      id: l.id,
      item_type_id: l.item_type_id,
      item_type_desc: l.item_type.item_type_desc.trim(),
      quantity: l.quantity,
      makat: l.makat,
      model: l.model,
      manufacturer_name: l.manufacturer_name,
      manufacturer_no: l.manufacturer_no,
      manufacturer_sku: l.manufacturer_sku,
      route_number: l.route_number,
      sort_order: l.sort_order,
      route_warning: routeWarning,
    });
  }

  const type = await loadPackageType(packageTypeId);
  return {
    package_type_id: packageTypeId,
    item_type_desc: type?.item_type_desc.trim() ?? "",
    default_route_number: type?.default_route_number ?? null,
    total_items: out.reduce((n, l) => n + l.quantity, 0),
    package_route_warnings: packageRouteWarnings,
    lines: out,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const typeId = Number(id);
    const type = await loadPackageType(typeId);
    if (!type) return NextResponse.json({ error: "סוג הפריט לא נמצא" }, { status: 404 });
    if (!type.is_package) return NextResponse.json({ error: "סוג הפריט אינו סוג מארז" }, { status: 400 });
    return NextResponse.json(await describe(typeId));
  } catch (error) {
    console.error("Error loading package contents:", error);
    return NextResponse.json({ error: "טעינת תכולת המארז נכשלה" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const typeId = Number(id);
    const type = await loadPackageType(typeId);
    if (!type) return NextResponse.json({ error: "סוג הפריט לא נמצא" }, { status: 404 });
    if (!type.is_package) return NextResponse.json({ error: "סוג הפריט אינו סוג מארז" }, { status: 400 });

    const body = await req.json();
    const rawLines: unknown = body?.lines;
    if (!Array.isArray(rawLines)) {
      return NextResponse.json({ error: "lines חייב להיות מערך" }, { status: 400 });
    }

    const lines: LineIn[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i] ?? {};
      const itemTypeId = Number(l.item_type_id);
      const quantity = Number(l.quantity);
      const routeNumber = l.route_number == null || l.route_number === "" ? 1 : Number(l.route_number);
      if (!Number.isInteger(itemTypeId)) {
        return NextResponse.json({ error: `שורה ${i + 1}: חסר סוג פריט`, lineIndex: i }, { status: 400 });
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return NextResponse.json({ error: `שורה ${i + 1}: הכמות חייבת להיות מספר שלם גדול מאפס`, lineIndex: i }, { status: 400 });
      }
      if (!Number.isInteger(routeNumber) || routeNumber < 1) {
        return NextResponse.json({ error: `שורה ${i + 1}: מספר מסלול לא תקין`, lineIndex: i }, { status: 400 });
      }
      if (seen.has(itemTypeId)) {
        return NextResponse.json({ error: `שורה ${i + 1}: סוג הפריט מופיע פעמיים`, lineIndex: i }, { status: 400 });
      }
      seen.add(itemTypeId);
      lines.push({
        item_type_id: itemTypeId,
        quantity,
        makat: l.makat == null ? null : String(l.makat).trim() || null,
        model: l.model == null ? null : String(l.model).trim() || null,
        manufacturer_name: l.manufacturer_name == null ? null : String(l.manufacturer_name).trim() || null,
        manufacturer_no: l.manufacturer_no == null ? null : String(l.manufacturer_no).trim() || null,
        manufacturer_sku: l.manufacturer_sku == null ? null : String(l.manufacturer_sku).trim() || null,
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
        if (!t) return NextResponse.json({ error: `שורה ${i + 1}: סוג הפריט לא נמצא`, lineIndex: i }, { status: 400 });
        if (t.is_package) {
          return NextResponse.json(
            { error: `שורה ${i + 1}: ${t.item_type_desc.trim()} הוא סוג מארז — אין קינון של מארזים`, lineIndex: i },
            { status: 400 },
          );
        }
      }
    }

    // The package's own default route travels with its contents (one save
    // button on the screen). Absent in the body → left untouched.
    let defaultRoute: number | null | undefined = undefined;
    if (body.default_route_number !== undefined) {
      const raw = body.default_route_number;
      if (raw === null || `${raw}`.trim() === "") defaultRoute = null;
      else {
        const n = Number(`${raw}`.trim());
        if (!Number.isInteger(n) || n < 1) {
          return NextResponse.json({ error: "מסלול ברירת מחדל למארז חייב להיות מספר שלם, 1 או יותר" }, { status: 400 });
        }
        defaultRoute = n;
      }
    }

    await prisma.$transaction(async (tx) => {
      if (defaultRoute !== undefined) {
        await tx.item_types.update({ where: { item_type_id: typeId }, data: { default_route_number: defaultRoute } });
      }
      await tx.package_contents.deleteMany({ where: { package_type_id: typeId } });
      if (lines.length > 0) {
        await tx.package_contents.createMany({
          data: lines.map((l) => ({
            package_type_id: typeId,
            item_type_id: l.item_type_id,
            quantity: l.quantity,
            makat: l.makat ?? null,
            model: l.model ?? null,
            manufacturer_name: l.manufacturer_name ?? null,
            manufacturer_no: l.manufacturer_no ?? null,
            manufacturer_sku: l.manufacturer_sku ?? null,
            route_number: l.route_number ?? 1,
            sort_order: l.sort_order ?? 0,
          })),
        });
      }
    });

    return NextResponse.json(await describe(typeId));
  } catch (error) {
    console.error("Error saving package contents:", error);
    return NextResponse.json({ error: "שמירת תכולת המארז נכשלה" }, { status: 500 });
  }
}
