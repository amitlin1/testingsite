import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { saveSignature } from "../../../lib/file-utils";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { withAuth } from "@/lib/auth/withAuth";
import { resolveShipmentWorker } from "@/lib/auth/shipment-worker";
import { nonPackageTypeIds } from "@/app/lib/packages/shipment-types";
import { syncShipmentBoxes } from "@/app/lib/packages/boxes";
import { PackageError, packageErrorResponse } from "@/app/lib/packages/errors";
import { SHIPMENT_TX, duplicateShipmentError, findDuplicateShipment, readShipmentLines, saveShipmentLines } from "@/app/lib/shipments/lines";

// GET: Fetch all shipments
export async function GET() {
  try {
    console.log("Fetching shipments...");
    // Package model (docs/packages/PLAN.md §9.10, §9.13): a shipment declares
    // package types and counts, so every counter here counts BOXES
    // (items.is_package, never the items inside them):
    //   sampled  = boxes taken in for this shipment
    //   started  = boxes that left the untouched state (opened / in test /
    //              waiting for items / finished)
    //   finished = boxes that closed (route finished)
    //   sent     = boxes returned to the customer (shipment_history)
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      WITH shipment_counts AS (
        SELECT
          i.shipment_id,
          COUNT(*)::int AS total_items,
          COUNT(*) FILTER (WHERE ir.item_id IS NOT NULL)::int AS sampled_amount,
          COUNT(*) FILTER (WHERE ir.current_status IN (1, 5))::int AS in_work_items,
          COUNT(*) FILTER (WHERE ir.current_status = 3 OR ir.is_finished = true)::int AS valid_items,
          COUNT(*) FILTER (WHERE ir.is_finished = true)::int AS valid_amount,
          COUNT(*) FILTER (WHERE ir.current_status = 3 OR ir.is_finished = true)::int AS finished_sampled_amount,
          COUNT(*) FILTER (
            WHERE ir.item_id IS NOT NULL
              AND (ir.current_status <> 2 OR ir.current_route_step > 1 OR ir.is_finished = true)
          )::int AS started_sampled_amount
        FROM items i
        JOIN item_types it ON it.item_type_id = i.item_type_id
        LEFT JOIN item_routes ir ON ir.item_id = i.item_id
        WHERE COALESCE(it.is_package, false) = true AND i.package_id IS NULL
        GROUP BY i.shipment_id
      ),
      sent_counts AS (
        SELECT shipment_id, COALESCE(SUM(amount), 0)::int AS sent_amount
        FROM shipment_history
        GROUP BY shipment_id
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
        s.received_at,
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
        COALESCE(sc.valid_amount, 0) as valid_amount,
        COALESCE(sc.finished_sampled_amount, 0) as finished_sampled_amount,
        COALESCE(sc.started_sampled_amount, 0) as started_sampled_amount,
        COALESCE(snt.sent_amount, 0) as sent_amount,
        (
            SELECT json_agg(json_build_object(
                'id', si.id,
                'item_type_id', si.item_type_id,
                'quantity', si.quantity,
                'makat', si.makat,
                'model', si.model,
                'manufacturer_name', si.manufacturer_name,
                'manufacturer_no', si.manufacturer_no,
                'cert_row_no', si.cert_row_no,
                'serial_no', si.serial_no,
                'batch_size', si.batch_size,
                'qty_to_test', si.qty_to_test,
                'purchase_order', si.purchase_order,
                'cert_row_raw', si.cert_row_raw,
                'item_type_desc', sit.item_type_desc
            ) ORDER BY si.id) -- the order the lines were entered: a line edited in place moves on disk, not here
            FROM shipment_items si
            JOIN item_types sit ON si.item_type_id = sit.item_type_id
            WHERE si.shipment_id = s.id
        ) as shipment_items
      FROM shipments s
      JOIN customers c ON s.customer_id = c.id
      LEFT JOIN sources src ON s.source_id = src.source_id
      LEFT JOIN shipment_counts sc ON sc.shipment_id = s.id
      LEFT JOIN sent_counts snt ON snt.shipment_id = s.id
      ORDER BY s.shipment_date DESC
    `);
    console.log(`Found ${rows.length} shipments`);

    // Normalize all timestamp fields to UTC ISO strings and build signature URLs
    const normalizedRows = rows.map((row: any) => ({
      ...row,
      shipment_date: normalizeToUtcIso(row.shipment_date),
      // timestamptz: already an instant, no zone guessing.
      received_at: row.received_at ? new Date(row.received_at).toISOString() : null,
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
//
// Only the roles that receive shipments (the /shipments page's). The lines are
// checked before anything is written (lib/shipments/lines.ts); the same
// certificate — number + customer — entered twice is refused with the
// existing shipment unless the form says the worker chose to enter it again
// (allow_duplicate).
export const POST = withAuth(async (request, { session }) => {
  try {
    const body = await request.json();
    const {
      customer_id,
      shipment_date,
      makat,
      recieving_worker_id,
      recieving_worker_name,
      shipment_items,
      signature_base64,
      sending_worker_id,
      sending_worker_name,
      source_id,
      poc_details,
    } = body;
    const shipment_code = typeof body.shipment_code === "string" ? body.shipment_code.trim() : "";

    if (!shipment_code) return NextResponse.json({ error: "חסר מספר משלוח" }, { status: 400 });
    if (shipment_code.length > 20) return NextResponse.json({ error: "מספר משלוח ארוך מ-20 תווים" }, { status: 400 });
    if (!customer_id) return NextResponse.json({ error: "חסר לקוח" }, { status: 400 });
    if (!shipment_date || Number.isNaN(new Date(shipment_date).getTime())) {
      return NextResponse.json({ error: "חסר תאריך משלוח" }, { status: 400 });
    }

    // POC details are English-only. This check MUST stay out here, with the
    // other input validation: it used to sit AFTER tx.shipments.create() inside
    // the $transaction callback, and `return NextResponse.json(...)` from
    // inside that callback does not abort the transaction — it just becomes the
    // callback's resolved value. So the shipment was committed anyway, the
    // response object was assigned to `newShipment`, and the handler re-wrapped
    // it as **201 carrying an error body**. Rejecting before any write is both
    // the correct answer and the only one that cannot half-happen.
    if (/[֐-׿]/.test(poc_details || "")) {
      return NextResponse.json(
        { error: "פרטי איש הקשר באנגלית בלבד" },
        { status: 400 },
      );
    }

    // Package model (docs/packages/PLAN.md §9.10): a shipment declares package
    // TYPES only — the items inside a box are never declared per shipment.
    const nonPackage = await nonPackageTypeIds(shipment_items);
    if (nonPackage.length > 0) {
      return NextResponse.json(
        { error: "משלוח מצהיר על סוגי מארזים בלבד", code: "SHIPMENT_TYPES_MUST_BE_PACKAGES", item_type_ids: nonPackage },
        { status: 400 },
      );
    }
    const lines = readShipmentLines(shipment_items, shipment_code);
    // The declared count is the lines' — never a number the client sent beside them.
    const amount = lines.length > 0 ? lines.reduce((sum, l) => sum + l.quantity, 0) : Number(body.amount);
    if (!(amount > 0)) return NextResponse.json({ error: "יש להצהיר על לפחות מארז אחד" }, { status: 400 });

    // "עובד מקבל": the logged-in worker, unless a manager picked someone else
    // (resolveShipmentWorker — never trust a non-manager's submitted id/name).
    const receiver = resolveShipmentWorker(session, { id: recieving_worker_id, name: recieving_worker_name });
    if ("error" in receiver) return NextResponse.json({ error: receiver.error }, { status: 400 });
    const finalRecievingWorkerId = receiver.worker.id;
    const finalRecievingWorkerName = receiver.worker.name;

    const newShipment = await prisma.$transaction(async (tx) => {
      const duplicate = await findDuplicateShipment(tx, shipment_code, Number(customer_id));
      if (duplicate && body.allow_duplicate !== true) throw duplicateShipmentError(duplicate);

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
          // The moment it entered the system; shipment_date is the certificate's.
          received_at: new Date(),
        },
      });
      await saveShipmentLines(tx, created.id, lines);

      // A box per declared unit, its id minted now: the labels print from
      // the shipment and the intake scans them (lib/packages/boxes.ts).
      await syncShipmentBoxes(tx, created.id);

      return created;
    }, SHIPMENT_TX);

    // The signature goes to storage after the commit: inside the transaction
    // its upload held the day's id counter for the network's time, and a save
    // that rolled back left the file behind.
    let signature_saved: boolean | null = null;
    if (signature_base64) {
      const signaturePath = await saveSignature(signature_base64, "recv", newShipment.id);
      signature_saved = !!signaturePath;
      if (signaturePath) {
        await prisma.shipments.update({ where: { id: newShipment.id }, data: { signature_path: signaturePath } });
        newShipment.signature_path = signaturePath;
      }
    }

    return NextResponse.json({ ...newShipment, signature_saved }, { status: 201 });
  } catch (error) {
    if (error instanceof PackageError) return packageErrorResponse(error, "");
    console.error("Error creating shipment:", error);
    return NextResponse.json(
      { error: "המשלוח לא נשמר — שגיאה בשרת" },
      { status: 500 },
    );
  }
}, { role: ["manager", "storekeeper"] });
