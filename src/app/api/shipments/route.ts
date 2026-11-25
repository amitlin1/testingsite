import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http/errors";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { POC_HAS_HEBREW } from "@/app/lib/shipments/contract";
import { loadShipments } from "@/app/lib/shipments/read";
import { createShipment, readDeclaredLines, readShipmentHeader, shipmentWorker } from "@/app/lib/shipments/save";
import { saveSignature } from "@/app/lib/shipments/signatures";

export async function GET() {
  try {
    return NextResponse.json(await loadShipments());
  } catch (error) {
    console.error("Error fetching shipments:", error);
    return NextResponse.json({ error: "Failed to fetch shipments" }, { status: 500 });
  }
}

/**
 * POST /api/shipments — a new shipment (lib/shipments/save.ts createShipment).
 * Only the roles that receive shipments. The same certificate — number +
 * customer — entered twice is refused with the existing shipment unless the
 * form says the worker chose to enter it again (allow_duplicate).
 */
export const POST = withAuth(async (request, { session }) => {
  try {
    const body = await request.json();
    const header = readShipmentHeader(body);

    // Checked before any write: nothing half-saves on a refusal.
    if (POC_HAS_HEBREW.test(body.poc_details || "")) {
      return NextResponse.json({ error: "פרטי איש הקשר באנגלית בלבד" }, { status: 400 });
    }

    const lines = await readDeclaredLines(body, header.shipment_code);
    // The declared count is the lines' — never a number the client sent beside them.
    const amount = lines.length > 0 ? lines.reduce((sum, l) => sum + l.quantity, 0) : Number(body.amount);
    if (!(amount > 0)) return NextResponse.json({ error: "יש להצהיר על לפחות מארז אחד" }, { status: 400 });

    // "עובד מקבל": the logged-in worker, unless a manager picked someone else.
    const receiver = shipmentWorker(session, { id: body.recieving_worker_id, name: body.recieving_worker_name });

    const newShipment = await createShipment({
      ...header,
      lines,
      amount,
      makat: body.makat || "",
      receiver,
      sender: { id: body.sending_worker_id || null, name: body.sending_worker_name || null },
      sourceId: body.source_id || null,
      poc: body.poc_details || null,
      allowDuplicate: body.allow_duplicate === true,
    });

    // The signature goes to storage after the commit: inside the transaction
    // its upload held the day's id counter for the network's time, and a save
    // that rolled back left the file behind.
    let signature_saved: boolean | null = null;
    if (body.signature_base64) {
      const signaturePath = await saveSignature(body.signature_base64, "recv", newShipment.id);
      signature_saved = !!signaturePath;
      if (signaturePath) {
        await prisma.shipments.update({ where: { id: newShipment.id }, data: { signature_path: signaturePath } });
        newShipment.signature_path = signaturePath;
      }
    }

    return NextResponse.json({ ...newShipment, signature_saved }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "המשלוח לא נשמר — שגיאה בשרת");
  }
}, { role: ACCESS.shipments });
