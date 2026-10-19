import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { findSerials } from "@/app/lib/packages/serials";

export const runtime = "nodejs";

const MAX_SERIALS = 500;

/**
 * POST /api/items/serials { serials: string[] } — which of these serials are
 * already on an item, for the intake's marks while the worker types or
 * pastes (lib/packages/serials.ts has the rule). Read only.
 *
 * Answers { matches: SerialMatch[] }, `serial` trimmed and upper case.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const serials: unknown = body?.serials;
    if (!Array.isArray(serials) || serials.length > MAX_SERIALS) {
      return NextResponse.json({ error: `יש לשלוח עד ${MAX_SERIALS} מספרים סריאליים` }, { status: 400 });
    }
    const matches = await findSerials(prisma, serials.map((s) => (s == null ? "" : String(s))));
    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error looking up serials:", error);
    return NextResponse.json({ error: "בדיקת המספרים הסריאליים נכשלה" }, { status: 500 });
  }
}
