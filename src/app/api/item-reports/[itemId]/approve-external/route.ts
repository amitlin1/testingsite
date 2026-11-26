import { NextResponse } from "next/server";
import { ACCESS } from "@/lib/auth/roles";
import { approveExternal } from "@/app/lib/item-report/lifecycle";
import { actorOf, readExternalApproval, withItemId } from "@/app/lib/item-report/http";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/[itemId]/approve-external
 *   { name, role?, note?, signature: "data:image/png;base64,…" }
 * An external approver passes a finished item whose report came out "לא תקין", signing on the
 * screen of the manager who shows them the report (the signed-in user — those who give the final
 * signature). The failed steps are passed and the report is locked with the approval, which stands
 * for the final signature → { version, passed }.
 * 400 bad body; 409 when there is nothing to approve (not finished / not failed / already signed,
 * approved or locked).
 */
export const POST = withItemId(async (req, { session, itemId }) => {
  try {
    const read = await readExternalApproval(req);
    if ("error" in read) return read.error;
    return NextResponse.json(await approveExternal(itemId, read.png, read.approval, actorOf(session)));
  } catch (e) {
    return errorResponse(e, "Failed to approve the report");
  }
}, { perm: ACCESS.reportFinalSign });
