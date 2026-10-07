import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { saveSignature } from "../../../lib/file-utils";
import { withAuth, type WithAuthCtx } from "@/lib/auth/withAuth";
import { resolveShipmentWorker } from "@/lib/auth/shipment-worker";

// GET: Fetch sent history aggregated by item type and makat for a specific shipment
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const shipment_id = searchParams.get("shipment_id");

    if (!shipment_id) {
        return NextResponse.json({ error: "Missing shipment_id" }, { status: 400 });
    }

    try {
        const rows = await prisma.$queryRaw<any[]>`
            SELECT
                item_type_id,
                makat,
                SUM(amount)::int as total_sent
            FROM shipment_history
            WHERE shipment_id = ${parseInt(shipment_id, 10)}
            GROUP BY item_type_id, makat
        `;

        return NextResponse.json(rows);
    } catch (error) {
        console.error("Error fetching shipment history:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Add new shipment history entries (Send Shipment)
export const POST = withAuth(async (request: NextRequest, { session }: WithAuthCtx) => {
    try {
        const body = await request.json();
        const { shipment_id, sent_date, sent_shipment_code, items, signature_base64 } = body;

        // "עובד מוציא": the logged-in worker, unless a manager picked someone else.
        const sender = resolveShipmentWorker(session, { id: body.sending_worker_id, name: body.sending_worker_name });
        if ("error" in sender) return NextResponse.json({ error: sender.error }, { status: 400 });
        const sending_worker_id = sender.worker.id;
        const sending_worker_name = sender.worker.name;

        // Basic validation
        if (!shipment_id || !sent_date || !sent_shipment_code || !items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json(
                { error: "Missing required fields or valid items" },
                { status: 400 }
            );
        }
        const shipment = await prisma.shipments.findUnique({ where: { id: Number(shipment_id) }, select: { is_sent: true } });
        if (!shipment) return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
        if (shipment.is_sent) return NextResponse.json({ error: "המשלוח כבר נשלח" }, { status: 409 });
        if (!signature_base64) {
            return NextResponse.json(
                { error: "Signature is required" },
                { status: 400 } // Bad Request - הלקוח לא עמד בתנאים
            );
        }

        await prisma.$transaction(async (tx) => {
            let signaturePath = null;
            if (signature_base64) {
                signaturePath = await saveSignature(signature_base64, 'send', shipment_id);
            }

            for (const item of items) {
                if (!item.item_type_id || !item.amount) continue;

                await tx.$executeRaw`
                    INSERT INTO shipment_history
                     (shipment_id, sending_worker_id, sending_worker_name, sent_date, sent_shipment_code, item_type_id, makat, amount, signature_path)
                     VALUES (${shipment_id}, ${sending_worker_id || null}, ${sending_worker_name || null}, ${new Date(sent_date)}::timestamp, ${sent_shipment_code}, ${item.item_type_id}, ${item.makat || null}, ${item.amount}, ${signaturePath})
                `;
            }

            // Check if shipment is finished
            const totalReceivedRows = await tx.$queryRaw<any[]>`
                SELECT COALESCE(SUM(quantity), 0)::int as total FROM shipment_items WHERE shipment_id = ${shipment_id}
            `;
            const totalReceived = totalReceivedRows[0]?.total || 0;

            const totalSentRows = await tx.$queryRaw<any[]>`
                SELECT COALESCE(SUM(amount), 0)::int as total FROM shipment_history WHERE shipment_id = ${shipment_id}
            `;
            const totalSent = totalSentRows[0]?.total || 0;

            if (totalReceived > 0 && totalSent >= totalReceived) {
                await tx.$executeRaw`
                    UPDATE shipments SET is_sent = true, finished_at = ${new Date(sent_date)}::timestamp WHERE id = ${shipment_id}
                `;
            }
        });

        return NextResponse.json({ success: true }, { status: 201 });
    } catch (error) {
        console.error("Error creating shipment history:", error);
        return NextResponse.json(
            { error: "Failed to create shipment history" },
            { status: 500 }
        );
    }
});
