import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/http/errors";
import { parseDbId } from "@/lib/http/request";
import { withAuth } from "@/lib/auth/withAuth";
import { ACCESS } from "@/lib/auth/roles";
import { PackageError } from "@/app/lib/packages/errors";
import { SHIPMENT_TX, deleteShipment, readDeclaredLines, readShipmentHeader, shipmentWorker, updateShipment } from "@/app/lib/shipments/save";
import { deleteSignature } from "@/app/lib/shipments/signatures";

const notFound = () => NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });

/**
 * PUT /api/shipments/[id] — the shipment edited (lib/shipments/save.ts
 * updateShipment); `dry_run: true` answers what the save would do to the
 * boxes and saves nothing.
 */
export const PUT = withAuth<{ id: string }>(async (request: NextRequest, { session, params }) => {
  const shipmentId = parseDbId(params.id);
  if (shipmentId == null) return notFound();
  try {
    // A sent shipment is closed for editing (the shipments table locks it too).
    const existing = await prisma.shipments.findUnique({
      where: { id: shipmentId },
      select: { is_sent: true, shipment_code: true, customer_id: true, recieving_worker_id: true, recieving_worker_name: true },
    });
    if (!existing) return notFound();
    if (existing.is_sent) return NextResponse.json({ error: "לא ניתן לערוך משלוח שנשלח" }, { status: 409 });

    const body = await request.json();
    const header = readShipmentHeader(body);
    // An edit by a non-manager keeps whoever already received the shipment.
    const receiver = shipmentWorker(
      session,
      { id: body.recieving_worker_id, name: body.recieving_worker_name },
      { id: existing.recieving_worker_id, name: existing.recieving_worker_name },
    );
    const lines = await readDeclaredLines(body, header.shipment_code);
    if (lines.length === 0) return NextResponse.json({ error: "יש להוסיף לפחות סוג מארז אחד עם כמות." }, { status: 400 });

    const dryRun = body.dry_run === true;
    const result = await updateShipment(shipmentId, existing, {
      ...header,
      lines,
      makat: body.makat || null,
      receiver,
      sender: { id: body.sending_worker_id || null, name: body.sending_worker_name || null },
      sourceId: body.source_id || null,
      allowDuplicate: body.allow_duplicate === true,
      // The forms send line ids (line_ids: true); an older client is matched by type, in order.
      byLineId: body.line_ids === true,
    }, { dryRun });

    if (dryRun) return NextResponse.json({ dry_run: true, boxes: result.boxes });
    return NextResponse.json({ ...result.shipment, boxes: result.boxes });
  } catch (e) {
    return errorResponse(e, "השינויים לא נשמרו — שגיאה בשרת");
  }
}, { role: ACCESS.shipments });

export const DELETE = withAuth<{ id: string }>(async (_req: NextRequest, { params }) => {
  const shipmentId = parseDbId(params.id);
  if (shipmentId == null) return notFound();
  try {
    const shipment = await prisma.shipments.findUnique({ where: { id: shipmentId } });
    if (!shipment) return notFound();
    if (shipment.is_sent) return NextResponse.json({ error: "לא ניתן למחוק משלוח שנשלח" }, { status: 400 });

    // Its signatures (the receipt and every send) leave storage once the delete committed.
    const sendSignatures = await prisma.shipment_history.findMany({
      where: { shipment_id: shipmentId, signature_path: { not: null } },
      select: { signature_path: true },
    });
    const signatures = [shipment.signature_path, ...sendSignatures.map((h) => h.signature_path)].filter((s): s is string => !!s);

    await prisma.$transaction((tx) => deleteShipment(tx, shipmentId), SHIPMENT_TX);
    for (const file of new Set(signatures)) await deleteSignature(shipmentId, file);

    return NextResponse.json({ message: "המשלוח נמחק בהצלחה" }, { status: 200 });
  } catch (e) {
    // 400, as the shipments table and the e2e suite (09-boxes) expect for "boxes were taken in".
    if (e instanceof PackageError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    return errorResponse(e, "שגיאה בביצוע המחיקה");
  }
}, { role: ACCESS.shipments });
