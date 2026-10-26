import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { bindCertificateRow } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * POST /api/packages/[id]/cert-row { barcode } — the certificate's equipment
 * row scanned at the opening station, at this box (boxes.ts
 * bindCertificateRow). The box becomes that row's when its label was on
 * another row's box. Answers { binding, package } — the row's serial for the
 * field it was scanned into, and the box as it is now.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const { id } = await params;
    let packageId: bigint;
    try {
      packageId = BigInt(parseBarcode(id).itemId);
    } catch {
      return NextResponse.json({ error: "מזהה מארז לא תקין" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const barcode = typeof body?.barcode === "string" ? body.barcode : "";
    const binding = await prisma.$transaction((tx) => bindCertificateRow(tx, packageId, barcode));
    return NextResponse.json({ ok: true, binding, package: await loadPackage(packageId) });
  } catch (error) {
    return packageErrorResponse(error, "קריאת שורת התעודה נכשלה");
  }
}
