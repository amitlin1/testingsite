import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseDbId } from "@/lib/http/request";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { errorResponse } from "@/lib/http/errors";
import { loadSentTotals } from "@/app/lib/shipments/read";
import { recordShipmentSend, shipmentWorker } from "@/app/lib/shipments/save";
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

/** POST — a send of the shipment's boxes (lib/shipments/save.ts recordShipmentSend). */
export const POST = withAuth(async (request: NextRequest, { session }: WithAuthCtx) => {
  try {
    const body = await request.json();
    const { sent_date, sent_shipment_code, items, signature_base64 } = body;
    const shipmentId = parseDbId(body.shipment_id);

    // "עובד מוציא": the logged-in worker, unless a manager picked someone else.
    const sender = shipmentWorker(session, { id: body.sending_worker_id, name: body.sending_worker_name });

    if (shipmentId == null || !sent_date || !sent_shipment_code || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "חסרים פרטי השליחה: קוד משלוח יוצא, תאריך וכמויות" }, { status: 400 });
    }
    const shipment = await prisma.shipments.findUnique({ where: { id: shipmentId }, select: { is_sent: true } });
    if (!shipment) return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
    if (shipment.is_sent) return NextResponse.json({ error: "המשלוח כבר נשלח" }, { status: 409 });
    if (!signature_base64) return NextResponse.json({ error: "חסרה חתימה" }, { status: 400 });

    // The signature is stored before the transaction (not inside it, where
    // its upload held the transaction open), and removed again if the send
    // does not commit.
    const signaturePath = await saveSignature(signature_base64, "send", shipmentId);
    await prisma.$transaction((tx) => recordShipmentSend(tx, {
      shipmentId,
      sentDate: new Date(sent_date),
      sentShipmentCode: sent_shipment_code,
      sender,
      items,
      signaturePath,
    })).catch(async (error) => {
      if (signaturePath) await deleteSignature(shipmentId, signaturePath);
      throw error;
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "השליחה לא נשמרה — שגיאה בשרת");
  }
}, { role: ACCESS.shipments });
