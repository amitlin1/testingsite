import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { withAuth } from "@/lib/auth/withAuth";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { createPackage, PackageInput, PackageItemInput } from "@/app/lib/packages/create-package";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { loadPackages, PackageStatusKey } from "@/app/lib/packages/read";
import { assertSerialsFree } from "@/app/lib/packages/serials";

export const runtime = "nodejs";

const STATUS_KEYS: PackageStatusKey[] = ["pending", "queue", "test", "waitItems", "readyClose", "done"];

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
    const int = (k: string) => {
      const v = sp.get(k);
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const status = sp.get("status");
    const rows = await loadPackages({
      shipmentId: int("shipment"),
      customerId: int("customer"),
      packageTypeId: int("type"),
      status: status && (STATUS_KEYS as string[]).includes(status) ? (status as PackageStatusKey) : null,
      q: sp.get("q"),
      excludeSent: int("shipment") == null && sp.get("includeSent") !== "1",
    });
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listing packages:", error);
    return NextResponse.json({ error: "טעינת המארזים נכשלה" }, { status: 500 });
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * POST /api/packages — intake of one box and everything inside it
 * (docs/packages/PLAN.md §6). Replaces POST /api/items.
 *
 * Body:
 *   customer, shipment, packageType   numbers
 *   routeNumber                        package route, default 1
 *   makat, model, manufacturer, manufacturerNo   package fields, optional
 *   items: [{ itemType, serialNumber, makat, model, manufacturer, manufacturerNo?, routeNumber? }]
 *
 * Answers 201 { ok, packageId, itemIds } — ids as numbers (16 digits, exact).
 * A serial twice in the box, or already on an item of the same type in this
 * shipment, answers 409 with `itemIndex` (lib/packages/serials.ts).
 *
 * Manager only: the screens take boxes in through the shipment's pending
 * boxes (lib/packages/boxes.ts); a box made here bypasses the shipment's
 * declared count. The seed and the e2e suites use it.
 */
export const POST = withAuth(async (req: NextRequest) => {
  // createPackage emits item_created into the metrics ledger, so refuse
  // loudly when the DB is behind this image.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json();

    const customer = num(body.customer);
    const shipment = num(body.shipment);
    const packageType = num(body.packageType);
    if (customer == null || shipment == null || packageType == null) {
      return NextResponse.json({ error: "חסרים לקוח, משלוח או סוג מארז" }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "מארז חייב להכיל לפחות פריט אחד" }, { status: 400 });
    }

    const items: PackageItemInput[] = [];
    for (let i = 0; i < body.items.length; i++) {
      const raw = body.items[i] ?? {};
      const itemType = num(raw.itemType);
      const serialNumber = str(raw.serialNumber).trim();
      const makat = str(raw.makat).trim();
      const model = str(raw.model).trim();
      const manufacturer = str(raw.manufacturer).trim();
      // Makat, model and manufacturer are optional (the certificate may not have them).
      if (itemType == null || !serialNumber) {
        return NextResponse.json(
          { error: `פריט ${i + 1}: יש למלא סוג ומספר סריאלי`, itemIndex: i },
          { status: 400 },
        );
      }
      items.push({
        itemType,
        serialNumber,
        makat,
        model,
        manufacturer,
        manufacturerNo: raw.manufacturerNo == null ? null : str(raw.manufacturerNo).trim(),
        routeNumber: num(raw.routeNumber),
      });
    }

    const input: PackageInput = {
      customer,
      shipment,
      packageType,
      routeNumber: num(body.routeNumber),
      makat: body.makat == null ? null : str(body.makat),
      model: body.model == null ? null : str(body.model),
      manufacturer: body.manufacturer == null ? null : str(body.manufacturer),
      manufacturerNo: body.manufacturerNo == null ? null : str(body.manufacturerNo),
      items,
    };

    const created = await prisma.$transaction(async (tx) => {
      await assertSerialsFree(tx, shipment, items);
      return createPackage(tx, input);
    });
    return NextResponse.json({ ok: true, ...created }, { status: 201 });
  } catch (error) {
    return packageErrorResponse(error, "יצירת המארז נכשלה");
  }
}, { role: "manager" });
