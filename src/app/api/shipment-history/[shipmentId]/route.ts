import { NextResponse } from "next/server";
import { parseDbId } from "@/lib/http/request";
import { loadShipmentSends } from "@/app/lib/shipments/read";

/** GET — the shipment's sends, newest first (ShipmentSend). */
export async function GET(_request: Request, context: { params: Promise<{ shipmentId: string }> }) {
  const shipmentId = parseDbId((await context.params).shipmentId);
  if (shipmentId == null) return NextResponse.json({ error: "מזהה משלוח לא תקין" }, { status: 400 });
  try {
    return NextResponse.json(await loadShipmentSends(shipmentId));
  } catch (error) {
    console.error("Error fetching shipment history:", error);
    return NextResponse.json({ error: "Failed to fetch shipment history" }, { status: 500 });
  }
}
