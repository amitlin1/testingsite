import { NextResponse } from "next/server";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { parseActor } from "@/app/lib/testing/actor";
import { stepBack } from "@/app/lib/testing/step-back";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { parseItemId } from "@/lib/http/request";

export const runtime = "nodejs";

/**
 * POST /api/testing/step-back { itemId, currentRouteStep, workerId?, workerName?, actionId? } —
 * "חזרה לבדיקה הקודמת" on a queue card (lib/testing/step-back.ts). Only who holds ACCESS.stepBack:
 * anyone else gets 403 before anything is read, and the testing screen does not show them the button.
 */
export const POST = withAuth((req) => ledgerWrite("שגיאה בהחזרת הפריט לעמדה הקודמת", async () => {
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const itemId = parseItemId(body?.itemId);
  const shownStep = Number(body?.currentRouteStep);
  if (itemId == null || !Number.isInteger(shownStep) || shownStep < 1) {
    throw new HttpError(400, "itemId and currentRouteStep are required");
  }
  return NextResponse.json(await stepBack({ itemId, shownStep, actor: parseActor(body, "stepBack") }));
}), { perm: ACCESS.stepBack });
