import { NextResponse, after } from "next/server";
import { ledgerWrite } from "@/app/lib/metrics/ledger/schema-gate";
import { freezeReportIfFinal, signReportWithResult } from "@/app/lib/item-report/lifecycle";
import { actorOf, decodePngSignature } from "@/app/lib/item-report/http";
import type { ResultAnswer } from "@/app/lib/testing/contract";
import { resultInputOf, submitResult, whereItemIsNow, type ResultRequest } from "@/app/lib/testing/submit-result";
import { ACCESS, can } from "@/lib/auth/roles";
import { isLiveSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { currentSession } from "@/lib/auth/current-session";

export const runtime = "nodejs";

/**
 * The closing's report signature (popup-templates report_sign, docs/features/ITEM_REPORTS.md), a PNG data
 * URL: when this result finishes the item's route, its report gets it in this same request — so a
 * refresh can never leave the box closed and the report without it. It does not lock the report:
 * the approver's final signature does. A signature that cannot be used refuses the submit before it
 * saves: the closing is either saved and signed, or not saved.
 */
async function closingSigningOf(signature: unknown) {
  if (signature === undefined) return null;
  const png = decodePngSignature(signature);
  if (!png) throw new HttpError(400, "ReportSignature must be a PNG data URL");
  const session = await currentSession();
  if (!isLiveSession(session) || !can(session.roles, ACCESS.reportClosingSign)) {
    throw new HttpError(403, "אין לך הרשאה לחתום על דוחות", { code: "REPORT_SIGN_FORBIDDEN" });
  }
  return { png, signer: actorOf(session) };
}

export function POST(req: Request) {
  return ledgerWrite("Failed to save test result", async () => {
    const body = (await readJsonObject(req)) as ResultRequest;
    const input = await resultInputOf(body);
    const signing = await closingSigningOf(body.ReportSignature);

    /** The report signed with this result, after it committed; never fails the submit. */
    const signReport = async (): Promise<Pick<ResultAnswer, "reportSign">> => {
      if (!signing) return {};
      try {
        return { reportSign: await signReportWithResult(input.itemId, signing.png, signing.signer) };
      } catch (e) {
        console.error(`[item-report] signing the report of item ${input.itemId} with its result failed`, e);
        return { reportSign: "failed" };
      }
    };

    const outcome = await submitResult(input);

    // A recognised replay: the original submit already committed, nothing was written this time.
    // Answer 200 so a retrying client stops retrying — the work it asked for IS done. Its next
    // station is gone with the original answer, so this one says where the item is now; and a retry
    // after a lost answer still signs, when the first attempt did not get to it.
    if (outcome.replay) {
      return NextResponse.json({
        ok: true, success: true, replay: true, ...(await whereItemIsNow(input.itemId)), ...(await signReport()),
      } satisfies ResultAnswer);
    }

    const answer: ResultAnswer = {
      ok: true,
      success: true,
      researchId: outcome.researchId,
      logId: outcome.logId,
      isLastStep: false,
      ...outcome.next,
    };
    if (outcome.recommendedResearchStation) answer.recommendedResearchStation = outcome.recommendedResearchStation;
    if (outcome.packageGate) answer.packageGate = outcome.packageGate;
    // Before the freeze below: a report that waits for this signature is frozen by the signing.
    Object.assign(answer, await signReport());

    // The item may have just finished its route: freeze its PDF report now, while the data is
    // exactly what it finished with (docs/features/ITEM_REPORTS.md). After the response and best-effort — it
    // never delays or fails the submit. (Called directly, outside a request — the integration
    // tests — after() throws; the freeze then just runs detached.)
    try {
      after(() => freezeReportIfFinal(input.itemId));
    } catch {
      void freezeReportIfFinal(input.itemId);
    }

    return NextResponse.json(answer);
  });
}
