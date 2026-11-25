import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { undoIntake } from "@/app/lib/packages/boxes";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { packageIdParam } from "@/app/lib/packages/http";

export const runtime = "nodejs";

/**
 * DELETE /api/packages/[id]/intake — "בטל קליטה": the box goes back to
 * waiting for intake, while nobody has worked on it yet (boxes.ts undoIntake).
 * ACCESS.intake only — the middleware's prefix rule cannot reach this path.
 */
export const DELETE = withAuth<{ id: string }>((_req: NextRequest, { params: { id } }) => ledgerWrite("ביטול הקליטה נכשל", async () => {
  const packageId = packageIdParam(id);
  await prisma.$transaction((tx) => undoIntake(tx, packageId));
  return NextResponse.json({ ok: true });
}), { role: ACCESS.intake });
