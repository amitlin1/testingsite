import { NextResponse } from "next/server";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { parseActor } from "@/app/lib/testing/actor";
import { STEP_BACK_REASON_MAX, stepBack } from "@/app/lib/testing/step-back";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { HttpError } from "@/lib/http/errors";
import { parseItemId } from "@/lib/http/request";

export const runtime = "nodejs";

/**
 * POST /api/testing/step-back { itemId, currentRouteStep, reason, workerId?, workerName?, actionId? } —
 * "חזרה לבדיקה הקודמת" on a queue card (lib/testing/step-back.ts). Managers and testers
 * (ACCESS.stepBack): anyone else gets 403 before anything is read, and the testing screen does not
 * show them the button. The reason is required (400 without one) and is printed on the item's report.
 */
export const POST = withAuth((req) => ledgerWrite("שגיאה בהחזרת הפריט לעמדה הקודמת", async () => {
  const body: Record<string, unknown> = await req.json().catch(() => ({}));
  const itemId = parseItemId(body?.itemId);
  const shownStep = Number(body?.currentRouteStep);
  if (itemId == null || !Number.isInteger(shownStep) || shownStep < 1) {
    throw new HttpError(400, "itemId and currentRouteStep are required");
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new HttpError(400, "חובה לכתוב למה מחזירים את הפריט.");
  if (reason.length > STEP_BACK_REASON_MAX) throw new HttpError(400, `הסיבה ארוכה מדי (עד ${STEP_BACK_REASON_MAX} תווים).`);
  return NextResponse.json(await stepBack({ itemId, shownStep, reason, actor: parseActor(body, "stepBack") }));
}), { role: ACCESS.stepBack });
