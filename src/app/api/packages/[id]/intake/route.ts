import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { INTAKE_ROLES } from "@/app/lib/packages/roles";
import { prisma } from "@/app/lib/prisma";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { undoIntake } from "@/app/lib/packages/boxes";
import { packageErrorResponse } from "@/app/lib/packages/errors";

export const runtime = "nodejs";

/**
 * DELETE /api/packages/[id]/intake — "בטל קליטה": the box goes back to
 * waiting for intake, while nobody has worked on it yet (boxes.ts undoIntake).
 * INTAKE_ROLES only — the middleware's prefix rule cannot reach this path.
 */
export const DELETE = withAuth(async (_req: NextRequest, _ctx, routeCtx) => {
  const { params } = routeCtx as { params: Promise<{ id: string }> };
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
    await prisma.$transaction((tx) => undoIntake(tx, packageId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return packageErrorResponse(error, "ביטול הקליטה נכשל");
  }
}, { role: INTAKE_ROLES });
