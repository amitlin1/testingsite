import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bindCertificateRow } from "@/app/lib/packages/boxes";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { packageIdParam } from "@/app/lib/packages/http";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * POST /api/packages/[id]/cert-row { barcode } — the certificate's equipment
 * row scanned at the opening station, at this box (boxes.ts
 * bindCertificateRow). The box becomes that row's when its label was on
 * another row's box. Answers { binding, package } — the row's serial for the
 * field it was scanned into, and the box as it is now.
 */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return ledgerWrite("קריאת שורת התעודה נכשלה", async () => {
    const packageId = packageIdParam((await params).id);
    const body = await req.json().catch(() => ({}));
    const barcode = typeof body?.barcode === "string" ? body.barcode : "";
    const binding = await prisma.$transaction((tx) => bindCertificateRow(tx, packageId, barcode));
    return NextResponse.json({ ok: true, binding, package: await loadPackage(packageId) });
  });
}
