import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { saveSignature } from "../../../lib/file-utils";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { withAuth } from "@/lib/auth/withAuth";
import { hasRole } from "@/lib/auth/roles";

// GET: Fetch all shipments
export async function GET() {
  try {
    console.log("Fetching shipments...");
    // Optimized: single CTE computes all item counts per shipment instead of 6 correlated subqueries
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      WITH shipment_counts AS (
        SELECT
          i.shipment_id,
          COUNT(*) FILTER (WHERE i.parent_item_id IS NULL)::int AS total_items,
          COUNT(*) FILTER (WHERE ir.item_id IS NOT NULL AND i.parent_item_id IS NULL)::int AS sampled_amount,
          COUNT(*) FILTER (WHERE ir.current_status = 1 AND i.parent_item_id IS NULL)::int AS in_work_items,
          COUNT(*) FILTER (WHERE ir.current_status = 3 AND i.parent_item_id IS NULL)::int AS valid_items,
          COUNT(*) FILTER (WHERE ir.is_finished = true AND i.parent_item_id IS NULL)::int AS valid_amount,
          COUNT(*) FILTER (WHERE (ir.current_status = 3 OR ir.is_finished = true) AND i.parent_item_id IS NULL)::int AS finished_sampled_amount,
          COUNT(*) FILTER (
            WHERE ir.item_id IS NOT NULL AND i.parent_item_id IS NULL
              AND (ir.current_status <> 2 OR ir.current_route_step > 1 OR ir.is_finished = true)
          )::int AS started_sampled_amount,
          COUNT(*) FILTER (WHERE ir.item_id IS NOT NULL AND i.parent_item_id IS NOT NULL)::int AS sub_items_sampled_amount
        FROM items i
        LEFT JOIN item_routes ir ON ir.item_id = i.item_id
        GROUP BY i.shipment_id
      )
      SELECT
        s.id,
        s.shipment_code,
        s.customer_id,
        c.customer_code,
        c.name as customer_name,
        s.shipment_date,
        s.amount,
        s.makat,
        s.signature_path,
        s.recieving_worker_id,
        s.recieving_worker_name,
        (SELECT si.item_type_id FROM shipment_items si WHERE si.shipment_id = s.id LIMIT 1) as item_type_id,
        (SELECT sit.item_type_desc FROM shipment_items si JOIN item_types sit ON si.item_type_id = sit.item_type_id WHERE si.shipment_id = s.id LIMIT 1) as item_type_desc,
        s.source_id,
        src.source_desc,
        s.sending_worker_id,
        s.sending_worker_name,
        s.poc_details,
        s.shipment_sent_date,
        s.is_sent,
        s.finished_at,
        COALESCE(sc.total_items, 0) as total_items,
        COALESCE(sc.in_work_items, 0) as in_work_items,
        COALESCE(sc.valid_items, 0) as valid_items,
        COALESCE(sc.sampled_amount, 0) as sampled_amount,
        COALESCE(sc.sub_items_sampled_amount, 0) as sub_items_sampled_amount,
        COALESCE(sc.valid_amount, 0) as valid_amount,
        COALESCE(sc.finished_sampled_amount, 0) as finished_sampled_amount,
        COALESCE(sc.started_sampled_amount, 0) as started_sampled_amount,
        (
            SELECT json_agg(json_build_object(
                'id', si.id,
                'item_type_id', si.item_type_id,
                'quantity', si.quantity,
                'makat', si.makat,
                'item_type_desc', sit.item_type_desc
            ))
            FROM shipment_items si
            JOIN item_types sit ON si.item_type_id = sit.item_type_id
            WHERE si.shipment_id = s.id
        ) as shipment_items
      FROM shipments s
      JOIN customers c ON s.customer_id = c.id
      LEFT JOIN sources src ON s.source_id = src.source_id
      LEFT JOIN shipment_counts sc ON sc.shipment_id = s.id
      ORDER BY s.shipment_date DESC
    `);
    console.log(`Found ${rows.length} shipments`);

    // Normalize all timestamp fields to UTC ISO strings and build signature URLs
    const normalizedRows = rows.map((row: any) => ({
      ...row,
      shipment_date: normalizeToUtcIso(row.shipment_date),
      shipment_sent_date: normalizeToUtcIso(row.shipment_sent_date),
      finished_at: normalizeToUtcIso(row.finished_at),
      signature_path: row.signature_path
        ? `/api/shipments/${row.id}/files/${row.signature_path}`
        : null,
    }));

    return NextResponse.json(normalizedRows);
  } catch (error) {
    console.error("Error fetching shipments:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipments" },
      { status: 500 },
    );
  }
}

// POST: Create a new shipment
export const POST = withAuth(async (request, { session }) => {
  try {
    const body = await request.json();
    const {
      shipment_code,
      customer_id,
      shipment_date,
      makat,
      amount,
      recieving_worker_id,
      recieving_worker_name,
      shipment_items,
      signature_base64,
      sending_worker_id,
      sending_worker_name,
      source_id,
      poc_details,
    } = body;

    // Basic validation
    if (!shipment_code || !customer_id || !shipment_date || !amount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // "עובד מקבל" (receiving worker): a storekeeper is always attributed as
    // THEMSELVES — never trust a client-submitted id/name for that case, same
    // integrity reasoning as any other server-derived identity field. Someone
    // else (e.g. a manager entering data on a storekeeper's behalf) falls
    // through to the manual picker's submitted id/name instead.
    let finalRecievingWorkerId: number | null = recieving_worker_id || null;
    let finalRecievingWorkerName: string | null = recieving_worker_name || null;
    if (hasRole(session.roles ?? [], "storekeeper")) {
      const empNo = session.user.employeeNumber ? Number(session.user.employeeNumber) : NaN;
      if (!Number.isFinite(empNo) || empNo <= 0) {
        return NextResponse.json(
          { error: "לא ניתן לזהות אותך כמחסנאי — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו ב'הגדרות > משתמשים'." },
          { status: 400 },
        );
      }
      finalRecievingWorkerId = empNo;
      finalRecievingWorkerName =
        session.user.displayName ?? session.user.name ?? session.user.preferredUsername;
    }

    const newShipment = await prisma.$transaction(async (tx) => {
      // First create the shipment without signature
      const created = await tx.shipments.create({
        data: {
          shipment_code,
          customer_id,
          shipment_date: new Date(shipment_date),
          makat: makat || "",
          amount,
          recieving_worker_id: finalRecievingWorkerId,
          recieving_worker_name: finalRecievingWorkerName,
          signature_path: null,
          sending_worker_id: sending_worker_id || null,
          sending_worker_name: sending_worker_name || null,
          source_id: source_id || null,
          poc_details: poc_details || null,
        },
      });
      const hasHebrew = /[\u0590-\u05FF]/.test(poc_details || "");
      if (hasHebrew) {
        return NextResponse.json(
          { error: "POC details must be in English only" },
          { status: 400 }
        );
      }

      // Now save signature with shipment ID for folder organization
      let signaturePath = null;
      if (signature_base64) {
        signaturePath = await saveSignature(
          signature_base64,
          "recv",
          created.id,
        );
        if (signaturePath) {
          await tx.shipments.update({
            where: { id: created.id },
            data: { signature_path: signaturePath },
          });
          created.signature_path = signaturePath;
        }
      }

      if (shipment_items && Array.isArray(shipment_items)) {
        for (const item of shipment_items) {
          await tx.shipment_items.create({
            data: {
              shipment_id: created.id,
              item_type_id: item.item_type_id,
              quantity: item.quantity,
              makat: item.makat || null,
            },
          });
        }
      }

      return created;
    });

    return NextResponse.json(newShipment, { status: 201 });
  } catch (error) {
    console.error("Error creating shipment:", error);
    return NextResponse.json(
      { error: "Failed to create shipment" },
      { status: 500 },
    );
  }
});
