import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { intakeBox } from "@/app/lib/packages/boxes";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { idOfLabel } from "@/app/lib/packages/ids";
import { loadPackage } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * POST /api/packages/intake { barcode } — the box label scanned at intake:
 * the pending box enters its route and its items are created from the
 * template, without serials (lib/packages/boxes.ts). Answers 201 { package }.
 * ACCESS.intake only.
 */
export const POST = withAuth((req: NextRequest) => ledgerWrite("קליטת המארז נכשלה", async () => {
  const body = await req.json().catch(() => null);
  const packageId = idOfLabel(typeof body?.barcode === "string" ? body.barcode.trim() : "");
  if (packageId == null) return NextResponse.json({ error: "הברקוד שנסרק אינו מדבקת מארז" }, { status: 400 });
  await prisma.$transaction((tx) => intakeBox(tx, packageId));
  return NextResponse.json({ ok: true, package: await loadPackage(packageId) }, { status: 201 });
}), { role: ACCESS.intake });
