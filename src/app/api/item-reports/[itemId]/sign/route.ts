import { ACCESS } from "@/lib/auth/roles";
import { signItemReport } from "@/app/lib/item-report/lifecycle";
import { signHandler } from "@/app/lib/item-report/http";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/[itemId]/sign { signature: "data:image/png;base64,…" }
 * The approver's final signature on a finished item's report; freezes it → { version }.
 * 409 when there is nothing to sign (not finished / no signature block / signed).
 */
export const POST = signHandler(signItemReport, { role: ACCESS.reportFinalSign });
