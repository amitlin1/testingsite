import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { getWorkersDirectory } from "@/lib/keycloak-admin";
import { loadPackageContext } from "@/app/lib/packages/context";
import { loadPackage, loadPackageTimeline } from "@/app/lib/packages/read";
import { resyncItemDims } from "@/app/lib/metrics/item-lifecycle";
import { DELETE as deleteRoutedRow } from "@/app/api/items/[id]/route";

export const runtime = "nodejs";

/**
 * GET /api/packages/[id] — the package page: the box, its items, the
 * package-level timeline (with worker names resolved from the directory).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let packageId: bigint;
    try {
      packageId = BigInt(parseBarcode(id).itemId);
    } catch {
      return NextResponse.json({ error: "מזהה מארז לא תקין" }, { status: 400 });
    }
    const view = await loadPackage(packageId);
    if (!view) return NextResponse.json({ error: "המארז לא נמצא" }, { status: 404 });

    const [timeline, workers] = await Promise.all([
      loadPackageTimeline(view),
      getWorkersDirectory().catch(() => [] as { worker_id: number; worker_name: string }[]),
    ]);
    const nameOf = new Map(workers.map((w) => [w.worker_id, w.worker_name]));
    return NextResponse.json({
      package: view,
      timeline: timeline.map((t) => ({ ...t, worker_name: t.worker_id != null ? (nameOf.get(t.worker_id) ?? null) : null })),
    });
  } catch (error) {
    console.error("Error loading package:", error);
    return NextResponse.json({ error: "טעינת המארז נכשלה" }, { status: 500 });
  }
}

/**
 * PATCH /api/packages/[id] — the open fields of a box: makat, model,
 * manufacturer, manufacturer no. Its type, customer and shipment are locked
 * (docs/packages/PLAN.md §4; design "עריכת מארז"): a type sent here that
 * differs answers 409.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let packageId: bigint;
    try {
      packageId = BigInt(parseBarcode(id).itemId);
    } catch {
      return NextResponse.json({ error: "מזהה מארז לא תקין" }, { status: 400 });
    }
    const ctx = await loadPackageContext(prisma, packageId);
    if (!ctx) return NextResponse.json({ error: "המארז לא נמצא" }, { status: 404 });
    if (!ctx.isPackage) return NextResponse.json({ error: "המזהה אינו של מארז" }, { status: 400 });

    const body = await req.json();
    if (body.itemType != null && Number(body.itemType) !== ctx.itemTypeId) {
      return NextResponse.json(
        { error: "סוג המארז אינו ניתן לשינוי — יש למחוק את המארז ולקלוט אותו מחדש", code: "PACKAGE_TYPE_LOCKED" },
        { status: 409 },
      );
    }
    if (body.customer != null || body.shipment != null) {
      return NextResponse.json({ error: "לקוח ומשלוח של מארז אינם ניתנים לשינוי", code: "PACKAGE_FIELDS_LOCKED" }, { status: 409 });
    }

    const data: { makat?: string; model?: string; manufacturer_name?: string; manufacturer_no?: string } = {};
    if (body.makat !== undefined) data.makat = String(body.makat ?? "").trim();
    if (body.model !== undefined) data.model = String(body.model ?? "").trim().slice(0, 50);
    if (body.manufacturer !== undefined) data.manufacturer_name = String(body.manufacturer ?? "").trim().slice(0, 50);
    if (body.manufacturerNo !== undefined) data.manufacturer_no = String(body.manufacturerNo ?? "").trim();

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.items.update({ where: { item_id: packageId }, data });
      }
      await resyncItemDims(tx, packageId);
    });

    const view = await loadPackage(packageId);
    return NextResponse.json({ ok: true, package: view });
  } catch (error) {
    console.error("Error updating package:", error);
    return NextResponse.json({ error: "עדכון המארז נכשל" }, { status: 500 });
  }
}

/** DELETE /api/packages/[id] — the same cascade as DELETE /api/items/[id]
 *  (a box is an items row): 409 with the items unless `cascade: true`. */
export const DELETE = deleteRoutedRow;
