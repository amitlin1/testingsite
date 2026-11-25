import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { intakePackage, type PackageItemInput } from "@/app/lib/packages/create-package";
import { parseDbId } from "@/lib/http/request";
import { numberField, readItemInput, textField } from "@/app/lib/packages/input";
import { loadPackages } from "@/app/lib/packages/read";
import { isPackageStatusKey } from "@/app/lib/packages/contract";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";

export const runtime = "nodejs";

/**
 * GET /api/packages?shipment&customer&type&status&q&includeSent — the packages
 * list: every box with its items' states, its own status and, when it waits
 * before closing, the items still out.
 *
 * Boxes whose shipment already went out (shipments.is_sent) are left out —
 * they are history, reachable from the package page. They come back when the
 * list is narrowed to one shipment (the shipments screen links a sent
 * shipment's boxes here) or with includeSent=1 (a scan of a box that left).
 */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    const shipmentId = parseDbId(sp.get("shipment"));
    const rows = await loadPackages({
      shipmentId,
      customerId: parseDbId(sp.get("customer")),
      packageTypeId: parseDbId(sp.get("type")),
      status: isPackageStatusKey(status) ? status : null,
      q: sp.get("q"),
      excludeSent: shipmentId == null && sp.get("includeSent") !== "1",
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listing packages:", error);
    return NextResponse.json({ error: "טעינת המארזים נכשלה" }, { status: 500 });
  }
}

/**
 * POST /api/packages — one box and everything inside it (docs/packages/PLAN.md
 * §6), create-package.ts intakePackage.
 *
 * Body:
 *   customer, shipment, packageType   numbers
 *   routeNumber                        package route, default the type's default route
 *   makat, model, manufacturer, manufacturerNo   package fields, optional
 *   items: [{ itemType, serialNumber, makat, model, manufacturer, manufacturerNo?, routeNumber? }]
 *
 * Answers 201 { ok, packageId, itemIds } — ids as numbers (15 digits, exact).
 * A serial twice in the box, or already on an item of the same type in this
 * shipment, answers 409 with `itemIndex`.
 *
 * Manager only: the screens take boxes in through the shipment's pending
 * boxes (lib/packages/boxes.ts); a box made here bypasses the shipment's
 * declared count. The seed and the e2e suites use it.
 */
export const POST = withAuth((req: NextRequest) => ledgerWrite("יצירת המארז נכשלה", async () => {
  const body = await req.json();

  const customer = parseDbId(body.customer);
  const shipment = parseDbId(body.shipment);
  const packageType = parseDbId(body.packageType);
  if (customer == null || shipment == null || packageType == null) {
    return NextResponse.json({ error: "חסרים לקוח, משלוח או סוג מארז" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "מארז חייב להכיל לפחות פריט אחד" }, { status: 400 });
  }

  const items: PackageItemInput[] = [];
  for (let i = 0; i < body.items.length; i++) {
    const item = readItemInput(body.items[i] ?? {});
    if (!item) {
      return NextResponse.json({ error: `פריט ${i + 1}: יש למלא סוג ומספר סריאלי`, itemIndex: i }, { status: 400 });
    }
    items.push(item);
  }

  const optional = (v: unknown) => (v == null ? null : textField(v));
  const created = await prisma.$transaction((tx) => intakePackage(tx, {
    customer,
    shipment,
    packageType,
    routeNumber: numberField(body.routeNumber),
    makat: optional(body.makat),
    model: optional(body.model),
    manufacturer: optional(body.manufacturer),
    manufacturerNo: optional(body.manufacturerNo),
    items,
  }));
  return NextResponse.json({ ok: true, ...created }, { status: 201 });
}), { role: ACCESS.createPackage });
