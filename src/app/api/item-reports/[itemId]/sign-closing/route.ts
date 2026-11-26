import { ACCESS } from "@/lib/auth/roles";
import { signClosingSignature } from "@/app/lib/item-report/lifecycle";
import { signHandler } from "@/app/lib/item-report/http";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/[itemId]/sign-closing { signature: "data:image/png;base64,…" }
 * The closing signature given on the item page, after the fact: for a finished item whose report
 * asks for it and is not locked yet (e.g. its box was closed before the template had the block, or
 * it was forgotten). The same signature the kit's closing gives (`signClosingSignature`): it does
 * not lock the report while a final signature is still to come → { version } (0 = not frozen).
 * 409 when there is nothing to sign (not finished / no closing block / already signed / locked).
 */
export const POST = signHandler(signClosingSignature, { perm: ACCESS.reportClosingSign });
