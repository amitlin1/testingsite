import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getCurrentUtcIso } from "@/app/lib/datetime";

// PUT: Update a shipment
export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const shipmentId = parseInt(id, 10);

    try {
        const body = await request.json();
        const { shipment_code, customer_id, shipment_date, amount, source_id, shipment_items, sending_worker_id, makat } = body;

        // Basic validation
        if (!shipment_code || !customer_id || !shipment_date || !amount) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const currentUtcIso = getCurrentUtcIso();
        const currentUtcDate = new Date(currentUtcIso);

        const result = await prisma.$transaction(async (tx) => {
            // Update shipment with CASE logic for shipment_sent_date
            const updateResult = await tx.$queryRaw<any[]>`
                UPDATE shipments
                SET shipment_code = ${shipment_code},
                    customer_id = ${customer_id},
                    shipment_date = ${new Date(shipment_date)}::timestamp,
                    amount = ${amount},
                    shipment_sent_date = CASE WHEN ${sending_worker_id || null}::int IS NOT NULL AND shipment_sent_date IS NULL THEN ${currentUtcDate}::timestamp ELSE shipment_sent_date END,
                    sending_worker_id = ${sending_worker_id || null},
                    makat = COALESCE(${makat || null}::int, makat),
                    source_id = ${source_id || null}::int
                WHERE id = ${shipmentId}
                RETURNING *
            `;

            if (!updateResult || updateResult.length === 0) {
                throw new Error("SHIPMENT_NOT_FOUND");
            }

            // Sync shipment_items: Delete all and re-insert
            await tx.shipment_items.deleteMany({
                where: { shipment_id: shipmentId },
            });

            if (shipment_items && Array.isArray(shipment_items)) {
                for (const item of shipment_items) {
                    await tx.shipment_items.create({
                        data: {
                            shipment_id: shipmentId,
                            item_type_id: item.item_type_id,
                            quantity: item.quantity,
                            makat: item.makat || null,
                        },
                    });
                }
            }

            return updateResult[0];
        });

        return NextResponse.json(result);
    } catch (e: any) {
        if (e.message === "SHIPMENT_NOT_FOUND") {
            return NextResponse.json(
                { error: "Shipment not found" },
                { status: 404 }
            );
        }
        console.error("Error updating shipment:", e);
        return NextResponse.json(
            { error: "Failed to update shipment" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const shipmentId = parseInt(id, 10);

    try {
        // 1. בדיקה אם המשלוח קיים
        const shipment = await prisma.shipments.findUnique({
            where: { id: shipmentId },
        });

        if (!shipment) {
            return NextResponse.json({ error: "המשלוח לא נמצא" }, { status: 404 });
        }

        // 2. בדיקה: האם המשלוח כבר בשימוש?
        // נבדוק האם קיימים פריטים בטבלת items שמשויכים למשלוח הזה
        const itemsCount = await prisma.items.count({
            where: { shipment_id: shipmentId },
        });

        // חסימת מחיקה אם: המשלוח נשלח או שיש פריטים משויכים
        if (shipment.is_sent || itemsCount > 0) {
            return NextResponse.json(
                { error: "לא ניתן למחוק משלוח שכבר נכנס לניהול פריטים או שנשלח" },
                { status: 400 }
            );
        }

        // 3. מחיקה בטרנזקציה (בטוחה)
        await prisma.$transaction(async (tx) => {
            // מחיקת כל הפריטים המשויכים למשלוח בטבלת shipment_items
            await tx.shipment_items.deleteMany({
                where: { shipment_id: shipmentId },
            });

            // מחיקת המשלוח עצמו
            await tx.shipments.delete({
                where: { id: shipmentId },
            });
        });

        return NextResponse.json({ message: "המשלוח נמחק בהצלחה" }, { status: 200 });

    } catch (e: any) {
        console.error("Error deleting shipment:", e);
        return NextResponse.json(
            { error: "שגיאה בביצוע המחיקה" },
            { status: 500 }
        );
    }
}