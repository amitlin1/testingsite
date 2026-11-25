import { NextResponse } from "next/server";
import { locateBarcode } from "@/app/lib/testing/locate";
import { errorResponse } from "@/lib/http/errors";

export const runtime = "nodejs";

/** GET /api/testing/locate-by-barcode?barcode=<label> — where the label's item is (lib/testing/locate.ts). */
export async function GET(req: Request) {
  try {
    const barcode = new URL(req.url).searchParams.get("barcode");
    if (!barcode) return NextResponse.json({ error: "barcode is required" }, { status: 400 });
    return NextResponse.json(await locateBarcode(barcode));
  } catch (error) {
    return errorResponse(error, "שגיאה באיתור הפריט");
  }
}
