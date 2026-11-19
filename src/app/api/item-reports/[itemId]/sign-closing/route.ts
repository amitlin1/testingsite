import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/withAuth";
import { ReportSignError, signClosingSignature } from "@/app/lib/item-report/generate";
import { REPORT_CLOSING_SIGN_ROLES } from "@/app/lib/item-report/roles";
import { actorOf, decodeImageDataUrl, parseItemId, type RouteCtx } from "@/app/lib/item-report/http";

export const runtime = "nodejs";

/**
 * POST /api/item-reports/[itemId]/sign-closing { signature: "data:image/png;base64,…" }
 * The closing signature given on the item page, after the fact: for a finished item whose report
 * asks for it and is not locked yet (e.g. its box was closed before the template had the block, or
 * it was forgotten). The same signature the kit's closing gives (`signClosingSignature`): it does
 * not lock the report while a final signature is still to come → { version } (0 = not frozen).
 * 409 when there is nothing to sign (not finished / no closing block / already signed / locked).
 */
export const POST = withAuth(async (req, { session }, routeCtx) => {
  const { itemId: raw } = await (routeCtx as RouteCtx<"itemId">).params;
  const itemId = parseItemId(raw);
  if (itemId == null) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { signature?: unknown } | null;
  const img = decodeImageDataUrl(body?.signature, 2 * 1024 * 1024);
  if (!img || img.type !== "image/png") return NextResponse.json({ error: "signature must be a PNG data URL" }, { status: 400 });
  try {
    return NextResponse.json(await signClosingSignature(itemId, img.bytes, actorOf(session)));
  } catch (e) {
    if (e instanceof ReportSignError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error(`[item-report] closing sign ${raw} failed`, e);
    return NextResponse.json({ error: "Failed to sign the report" }, { status: 500 });
  }
}, { role: REPORT_CLOSING_SIGN_ROLES });
