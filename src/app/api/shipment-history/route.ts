import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseDbId } from "@/lib/http/request";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { errorResponse } from "@/lib/http/errors";
import { loadSentTotals } from "@/app/lib/shipments/read";
import { SHIPMENT_TX, readShipmentSends, recordShipmentSend, shipmentWorker } from "@/app/lib/shipments/save";
import { deleteSignature, saveSignature } from "@/app/lib/shipments/signatures";

/** GET ?shipment_id — how many boxes of each type and makat the shipment already sent. */
export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("shipment_id");
  if (!raw) return NextResponse.json({ error: "Missing shipment_id" }, { status: 400 });
  const shipmentId = parseDbId(raw);
  if (shipmentId == null) return NextResponse.json({ error: "מזהה משלוח לא תקין" }, { status: 400 });
  try {
    return NextResponse.json(await loadSentTotals(shipmentId));
  } catch (error) {
    console.error("Error fetching shipment history:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

/**
 * POST — one send of boxes: of one shipment, or of
 * several at once (`shipments`, lib/shipments/save.ts readShipmentSends).
 * All of it commits together or none of it (recordShipmentSend per shipment).
 */
export const POST = withAuth(async (request: NextRequest, { session }: WithAuthCtx) => {
  try {
    const body = await request.json();
    const { sent_date, signature_base64 } = body;

    // "עובד מוציא": the logged-in worker, unless a manager picked someone else.
    const sender = shipmentWorker(session, { id: body.sending_worker_id, name: body.sending_worker_name });

    const sends = readShipmentSends(body);
    if (!sent_date) {
      return NextResponse.json({ error: "חסרים פרטי השליחה: תאריך וכמויות" }, { status: 400 });
    }
    const found = await prisma.shipments.findMany({
      where: { id: { in: sends.map((s) => s.shipmentId) } },
      select: { id: true, is_sent: true, shipment_code: true },
    });
    if (found.length !== sends.length) return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
    const alreadySent = found.find((s) => s.is_sent);
    if (alreadySent) return NextResponse.json({ error: `המשלוח ${alreadySent.shipment_code} כבר נשלח` }, { status: 409 });
    if (!signature_base64) return NextResponse.json({ error: "חסרה חתימה" }, { status: 400 });

    // The signature is stored before the transaction (not inside it, where
    // its upload held the transaction open) — a copy in each shipment's own
    // folder, where its history reads it — and removed again if the send does
    // not commit.
    const signatures = new Map<number, string | null>();
    try {
      for (const { shipmentId } of sends) signatures.set(shipmentId, await saveSignature(signature_base64, "send", shipmentId));
      await prisma.$transaction(async (tx) => {
        for (const send of sends) {
          await recordShipmentSend(tx, {
            ...send,
            sentDate: new Date(sent_date),
            sender,
            signaturePath: signatures.get(send.shipmentId) ?? null,
          });
        }
      }, SHIPMENT_TX);
    } catch (error) {
      for (const [shipmentId, path] of signatures) if (path) await deleteSignature(shipmentId, path);
      throw error;
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "השליחה לא נשמרה — שגיאה בשרת");
  }
}, { perm: ACCESS.shipments });
