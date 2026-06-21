import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

// GET: Fetch history for a specific shipment
export async function GET(
    request: Request,
    context: { params: Promise<{ shipmentId: string }> }
) {
    const { shipmentId } = await context.params;

    try {
        const rows = await prisma.$queryRaw<any[]>`
            SELECT
                sh.log_id,
                sh.shipment_id,
                sh.sent_shipment_code,
                sh.sent_date,
                sh.sending_worker_id,
                w.worker_name as sending_worker_name,
                sh.item_type_id,
                it.item_type_desc,
                sh.makat,
                sh.amount,
                sh.signature_path
            FROM shipment_history sh
            LEFT JOIN workers w ON sh.sending_worker_id = w.worker_id
            LEFT JOIN item_types it ON sh.item_type_id = it.item_type_id
            WHERE sh.shipment_id = ${parseInt(shipmentId, 10)}
            ORDER BY sh.sent_date DESC, sh.log_id DESC
        `;

        // Transform signature_path to API URL
        const transformedRows = rows.map((row: any) => ({
            ...row,
            signature_path: row.signature_path
                ? `/api/shipments/${shipmentId}/files/${row.signature_path}`
                : null,
        }));

        return NextResponse.json(transformedRows);
    } catch (error) {
        console.error("Error fetching shipment history:", error);
        return NextResponse.json(
            { error: "Failed to fetch shipment history" },
            { status: 500 }
        );
    }
}
