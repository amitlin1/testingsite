import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { resolveShipmentWorker } from "@/lib/auth/shipment-worker";
import { deleteSignature } from "@/lib/file-utils";
import { nonPackageTypeIds } from "@/app/lib/packages/shipment-types";
import { dropShipmentBoxes, syncShipmentBoxes, type BoxSync } from "@/app/lib/packages/boxes";
import { PackageError, packageErrorResponse } from "@/app/lib/packages/errors";
import { SHIPMENT_TX, duplicateShipmentError, findDuplicateShipment, readShipmentLines, saveShipmentLines } from "@/app/lib/shipments/lines";

/** withAuth passes only (req, ctx); recover the [id] from the path. */
function idFromReq(req: NextRequest): number {
    const parts = req.nextUrl.pathname.split("/").filter(Boolean); // api / shipments / <id>
    const i = parts.indexOf("shipments");
    return parseInt((i >= 0 ? parts[i + 1] : "") ?? "", 10);
}

/** A dry run's answer travels out of the transaction as a throw, so nothing commits. */
class DryRun {
    constructor(readonly boxes: BoxSync) {}
}

// PUT: Update a shipment
//
// The lines are saved in place by their line_id, so every line keeps its own
// boxes (lib/shipments/lines.ts, lib/packages/boxes.ts). `dry_run: true` does
// all of it and rolls back, answering what would happen to the boxes — the
// form shows the labels that stop being valid before the worker confirms.
export const PUT = withAuth(async (request: NextRequest, { session }: WithAuthCtx) => {
    const shipmentId = idFromReq(request);

    try {
        // A sent shipment is closed for editing (the shipments table locks it too).
        const existing = await prisma.shipments.findUnique({
            where: { id: shipmentId },
            select: { is_sent: true, shipment_code: true, customer_id: true, recieving_worker_id: true, recieving_worker_name: true },
        });
        if (!existing) return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
        if (existing.is_sent) return NextResponse.json({ error: "לא ניתן לערוך משלוח שנשלח" }, { status: 409 });

        const body = await request.json();
        const { customer_id, shipment_date, source_id, shipment_items, sending_worker_id, sending_worker_name, recieving_worker_id, recieving_worker_name, makat } = body;
        const shipment_code = typeof body.shipment_code === "string" ? body.shipment_code.trim() : "";

        if (!shipment_code) return NextResponse.json({ error: "חסר מספר משלוח" }, { status: 400 });
        if (shipment_code.length > 20) return NextResponse.json({ error: "מספר משלוח ארוך מ-20 תווים" }, { status: 400 });
        if (!customer_id) return NextResponse.json({ error: "חסר לקוח" }, { status: 400 });
        if (!shipment_date || Number.isNaN(new Date(shipment_date).getTime())) {
            return NextResponse.json({ error: "חסר תאריך משלוח" }, { status: 400 });
        }

        // Same rule as POST /api/shipments (resolveShipmentWorker), except that an
        // edit by a non-manager keeps whoever already received the shipment.
        const receiver = resolveShipmentWorker(
            session,
            { id: recieving_worker_id, name: recieving_worker_name },
            { id: existing.recieving_worker_id, name: existing.recieving_worker_name },
        );
        if ("error" in receiver) return NextResponse.json({ error: receiver.error }, { status: 400 });
        const finalRecievingWorkerId = receiver.worker.id;
        const finalRecievingWorkerName = receiver.worker.name;

        // Package model (docs/packages/PLAN.md §9.10): declared lines are
        // package types only — same rule as POST /api/shipments.
        const nonPackage = await nonPackageTypeIds(shipment_items);
        if (nonPackage.length > 0) {
            return NextResponse.json(
                { error: "משלוח מצהיר על סוגי מארזים בלבד", code: "SHIPMENT_TYPES_MUST_BE_PACKAGES", item_type_ids: nonPackage },
                { status: 400 },
            );
        }
        const lines = readShipmentLines(shipment_items, shipment_code);
        if (lines.length === 0) return NextResponse.json({ error: "יש להוסיף לפחות סוג מארז אחד עם כמות." }, { status: 400 });
        const amount = lines.reduce((sum, l) => sum + l.quantity, 0);

        const customerChanged = Number(customer_id) !== existing.customer_id;
        const certificateChanged = customerChanged || shipment_code.toUpperCase() !== (existing.shipment_code ?? "").trim().toUpperCase();

        const currentUtcIso = getCurrentUtcIso();
        const currentUtcDate = new Date(currentUtcIso);

        const result = await prisma.$transaction(async (tx) => {
            if (certificateChanged) {
                const duplicate = await findDuplicateShipment(tx, shipment_code, Number(customer_id), shipmentId);
                if (duplicate && body.allow_duplicate !== true) throw duplicateShipmentError(duplicate);
            }
            // The customer is in every box id and on everything taken in: once a
            // box was taken in, the shipment keeps its customer.
            if (customerChanged) {
                const takenIn = await tx.$queryRaw<{ n: number }[]>`
                    SELECT COUNT(*)::int AS n FROM items i JOIN item_routes ir ON ir.item_id = i.item_id WHERE i.shipment_id = ${shipmentId}
                `;
                if ((takenIn[0]?.n ?? 0) > 0) {
                    throw new PackageError("SHIPMENT_CUSTOMER_TAKEN_IN", "מארזים מהמשלוח כבר נקלטו — אי אפשר לשנות את הלקוח", 409);
                }
            }

            // Update shipment with CASE logic for shipment_sent_date
            const updateResult = await tx.$queryRaw<any[]>`
                UPDATE shipments
                SET shipment_code = ${shipment_code},
                    customer_id = ${customer_id},
                    shipment_date = ${new Date(shipment_date)}::timestamp,
                    amount = ${amount},
                    shipment_sent_date = CASE WHEN ${sending_worker_id || null}::int IS NOT NULL AND shipment_sent_date IS NULL THEN ${currentUtcDate}::timestamp ELSE shipment_sent_date END,
                    sending_worker_id = ${sending_worker_id || null},
                    sending_worker_name = ${sending_worker_name || null},
                    recieving_worker_id = ${finalRecievingWorkerId},
                    recieving_worker_name = ${finalRecievingWorkerName},
                    makat = COALESCE(${makat || null}, makat),
                    source_id = ${source_id || null}::int
                WHERE id = ${shipmentId}
                RETURNING *
            `;

            if (!updateResult || updateResult.length === 0) {
                throw new Error("SHIPMENT_NOT_FOUND");
            }

            // Lines in place, then the boxes follow them: new units get boxes,
            // dropped units lose their pending ones; fewer than were taken in
            // is refused.
            // The forms send line ids (line_ids: true); an older client is matched by type, in order.
            const goneWithLines = await saveShipmentLines(tx, shipmentId, lines, body.line_ids === true);
            const synced = await syncShipmentBoxes(tx, shipmentId);
            const boxes: BoxSync = { ...synced, removed: [...goneWithLines, ...synced.removed] };
            if (body.dry_run === true) throw new DryRun(boxes);

            return { shipment: updateResult[0], boxes };
        }, SHIPMENT_TX);

        return NextResponse.json({ ...result.shipment, boxes: result.boxes });
    } catch (e: any) {
        if (e instanceof DryRun) return NextResponse.json({ dry_run: true, boxes: e.boxes });
        if (e instanceof PackageError) return packageErrorResponse(e, "");
        if (e.message === "SHIPMENT_NOT_FOUND") {
            return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
        }
        console.error("Error updating shipment:", e);
        return NextResponse.json(
            { error: "השינויים לא נשמרו — שגיאה בשרת" },
            { status: 500 }
        );
    }
}, { role: ["manager", "storekeeper"] });

export const DELETE = withAuth(async (request: NextRequest) => {
    const shipmentId = idFromReq(request);

    try {
        // 1. בדיקה אם המשלוח קיים
        const shipment = await prisma.shipments.findUnique({
            where: { id: shipmentId },
        });

        if (!shipment) {
            return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
        }

        // 2. משלוח שנשלח לא נמחק
        if (shipment.is_sent) {
            return NextResponse.json(
                { error: "לא ניתן למחוק משלוח שנשלח" },
                { status: 400 }
            );
        }

        // החתימות של המשלוח (קבלה ושליחות חלקיות) — נמחקות מהאחסון אחרי שהמחיקה נשמרה.
        const sendSignatures = await prisma.shipment_history.findMany({
            where: { shipment_id: shipmentId, signature_path: { not: null } },
            select: { signature_path: true },
        });
        const signatures = [shipment.signature_path, ...sendSignatures.map((h) => h.signature_path)].filter((s): s is string => !!s);

        // 3. מחיקה בטרנזקציה (בטוחה). המארזים שממתינים לקליטה נמחקים איתו;
        // מארז שכבר נקלט חוסם את המחיקה (lib/packages/boxes.ts).
        await prisma.$transaction(async (tx) => {
            await dropShipmentBoxes(tx, shipmentId);

            // מחיקת כל הפריטים המשויכים למשלוח בטבלת shipment_items
            await tx.shipment_items.deleteMany({
                where: { shipment_id: shipmentId },
            });

            // מחיקת המשלוח עצמו
            await tx.shipments.delete({
                where: { id: shipmentId },
            });
        }, SHIPMENT_TX);

        for (const file of new Set(signatures)) await deleteSignature(shipmentId, file);

        return NextResponse.json({ message: "המשלוח נמחק בהצלחה" }, { status: 200 });

    } catch (e: any) {
        // 400, as the shipments table and its tests expect for "boxes were taken in".
        if (e instanceof PackageError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
        console.error("Error deleting shipment:", e);
        return NextResponse.json(
            { error: "שגיאה בביצוע המחיקה" },
            { status: 500 }
        );
    }
}, { role: ["manager", "storekeeper"] });
