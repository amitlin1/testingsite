import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { intakeBox } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * POST /api/packages/intake { barcode } — the box label scanned at intake:
 * the pending box enters its route and its items are created from the
 * template, without serials (lib/packages/boxes.ts). Answers 201 { package }.
 */
export async function POST(req: Request) {
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json().catch(() => null);
    const barcode = typeof body?.barcode === "string" ? body.barcode.trim() : "";
    let packageId: bigint;
    try {
      packageId = BigInt(parseBarcode(barcode).itemId);
    } catch {
      return NextResponse.json({ error: "הברקוד שנסרק אינו מדבקת מארז" }, { status: 400 });
    }
    await prisma.$transaction((tx) => intakeBox(tx, packageId));
    return NextResponse.json({ ok: true, package: await loadPackage(packageId) }, { status: 201 });
  } catch (error) {
    return packageErrorResponse(error, "קליטת המארז נכשלה");
  }
}
