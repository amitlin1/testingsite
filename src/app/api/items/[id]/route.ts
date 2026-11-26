import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadItemDetail } from "@/app/lib/items/read";
import { ensureWorkCalendar } from "@/app/lib/metrics/ledger/calendar-sync";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { idOfLabel } from "@/app/lib/packages/ids";
import { deleteItem, editItem } from "@/app/lib/packages/item-writes";

export const runtime = "nodejs";

const BAD_ID = () => NextResponse.json({ error: "מזהה פריט לא תקין" }, { status: 400 });

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const itemId = idOfLabel((await params).id);
    if (itemId == null) return BAD_ID();
    await ensureWorkCalendar(); // net_work_seconds is read off the work calendar
    return NextResponse.json(await loadItemDetail(itemId));
  } catch (error) {
    console.error("Error loading item:", error);
    return NextResponse.json({ item: null, history: [] });
  }
}

/** PUT: the editable fields of an item or a box (lib/packages/item-writes.ts editItem). */
export function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ledgerWrite("עדכון הפריט נכשל", async () => {
    const itemId = idOfLabel((await params).id);
    if (itemId == null) return BAD_ID();

    const body = await req.json();
    const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo } = body;
    // Makat, model and manufacturer are optional: an item takes its box's
    // (the shipment certificate's), which may leave any of them empty.
    if (!customer || !itemType) {
      return NextResponse.json({ error: "יש למלא לקוח וסוג" }, { status: 400 });
    }

    const result = await prisma.$transaction((tx) => editItem(tx, itemId, {
      customer: Number(customer),
      itemType: Number(itemType),
      serialNumber: serialNumber ? String(serialNumber) : null,
      makat: String(makat ?? "").trim(),
      model: String(model ?? ""),
      manufacturer: String(manufacturer ?? ""),
      manufacturerNo: manufacturerNo != null ? String(manufacturerNo) : "",
      confirmPackageReset: body.confirmPackageReset === true,
      workerId: typeof body.workerId === "number" ? body.workerId : null,
      workerName: typeof body.workerName === "string" && body.workerName ? body.workerName : null,
    }));
    return NextResponse.json({ ok: true, ...result });
  });
}

/** DELETE: the item, or the box with its items with `cascade: true` (lib/packages/item-writes.ts deleteItem). */
export function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ledgerWrite("מחיקת הפריט נכשלה", async () => {
    const itemId = idOfLabel((await params).id);
    if (itemId == null) return BAD_ID();
    const body = await req.json().catch(() => null);
    const result = await deleteItem(itemId, { cascade: !!body?.cascade });
    return NextResponse.json({ ok: true, ...result });
  });
}
