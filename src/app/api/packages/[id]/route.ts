import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { loadWorkerNames } from "@/app/lib/items/worker-names";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { packageIdParam } from "@/app/lib/packages/http";
import { idOfLabel } from "@/app/lib/packages/ids";
import { loadPackageContext } from "@/app/lib/packages/context";
import { deleteItem } from "@/app/lib/packages/item-writes";
import { fitChar50 } from "@/app/lib/packages/lifecycle";
import { loadPackage, loadPackageTimeline } from "@/app/lib/packages/read";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/packages/[id] — the package page: the box, its items, the
 * package-level timeline (with worker names resolved from the directory).
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const packageId = packageIdParam((await params).id);
    const view = await loadPackage(packageId);
    if (!view) return NextResponse.json({ error: "המארז לא נמצא" }, { status: 404 });

    const [timeline, nameOf] = await Promise.all([loadPackageTimeline(view), loadWorkerNames("Package timeline")]);
    return NextResponse.json({
      package: view,
      timeline: timeline.map((t) => ({ ...t, worker_name: t.worker_id != null ? (nameOf.get(t.worker_id) ?? null) : null })),
    });
  } catch (error) {
    return errorResponse(error, "טעינת המארז נכשלה");
  }
}

/**
 * PATCH /api/packages/[id] — the open fields of a box: makat, model,
 * manufacturer, manufacturer no. Only the box row: its items keep theirs
 * (unlike the intake and the certificate-row binding, which copy them). Its
 * type, customer and shipment are locked (docs/features/packages/PLAN.md §4; design
 * "עריכת מארז"): a type sent here that differs answers 409. None of these
 * fields is frozen into the metrics ledger, so nothing there changes.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const packageId = packageIdParam((await params).id);
    const body = await req.json();
    const ctx = await loadPackageContext(prisma, packageId);
    if (!ctx) throw new HttpError(404, "המארז לא נמצא");
    if (!ctx.isPackage) throw new HttpError(400, "המזהה אינו של מארז");
    if (body.itemType != null && Number(body.itemType) !== ctx.itemTypeId) {
      throw new HttpError(409, "סוג המארז אינו ניתן לשינוי — יש למחוק את המארז ולקלוט אותו מחדש", { code: "PACKAGE_TYPE_LOCKED" });
    }
    if (body.customer != null || body.shipment != null) {
      throw new HttpError(409, "לקוח ומשלוח של מארז אינם ניתנים לשינוי", { code: "PACKAGE_FIELDS_LOCKED" });
    }

    const data: { makat?: string; model?: string; manufacturer_name?: string; manufacturer_no?: string } = {};
    if (body.makat !== undefined) data.makat = String(body.makat ?? "").trim();
    if (body.model !== undefined) data.model = fitChar50(String(body.model ?? ""));
    if (body.manufacturer !== undefined) data.manufacturer_name = fitChar50(String(body.manufacturer ?? ""));
    if (body.manufacturerNo !== undefined) data.manufacturer_no = String(body.manufacturerNo ?? "").trim();
    if (Object.keys(data).length > 0) await prisma.items.update({ where: { item_id: packageId }, data });

    return NextResponse.json({ ok: true, package: await loadPackage(packageId) });
  } catch (error) {
    return errorResponse(error, "עדכון המארז נכשל");
  }
}

/** DELETE /api/packages/[id] — a box is an items row: the same delete as
 *  DELETE /api/items/[id] — 409 with its items unless `cascade: true`. */
export function DELETE(req: Request, { params }: Ctx) {
  return ledgerWrite("מחיקת הפריט נכשלה", async () => {
    const packageId = idOfLabel((await params).id);
    if (packageId == null) return NextResponse.json({ error: "מזהה פריט לא תקין" }, { status: 400 });
    const body = await req.json().catch(() => null);
    return NextResponse.json({ ok: true, ...(await deleteItem(packageId, { cascade: !!body?.cascade })) });
  });
}
