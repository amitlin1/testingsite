import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { getWorkersDirectory } from "@/lib/keycloak-admin";

export const runtime = "nodejs";

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return obj;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    const [itemResult, connectedResult, historyResult, workersDirectory] = await Promise.all([
      prisma.$queryRaw<any[]>`
        SELECT
          i.item_id,
          i.makat,
          i.serial_no,
          i.parent_item_id,
          it.item_type_desc,
          ir.current_status,
          ir.current_status AS item_status_id,
          s.item_status_desc,
          tr.route_steps,
          tst.test_type_desc,
          ir.current_route_step,
          ir.test_station_id,
          ts.test_station_desc,
          ir.created_at,
          ir.finished_at,
          ir.is_finished,
          (
              SELECT json_agg(
                         json_build_object(
                             'id', u.step,
                             'desc', tst2.test_type_desc
                         )
                         ORDER BY u.ord
                     )
              FROM (
                  SELECT step, ord
                  FROM unnest(tr.route_steps) WITH ORDINALITY AS u(step, ord)
              ) u
              JOIN test_stations_type tst2
                  ON tst2.test_station_type_id = u.step
          ) AS route_stations
      FROM items i
      LEFT JOIN item_types it           ON it.item_type_id = i.item_type_id
      LEFT JOIN item_routes ir          ON ir.item_id = i.item_id
      LEFT JOIN item_status s           ON s.item_status_id = ir.current_status
      LEFT JOIN test_stations ts        ON ts.test_station_id = ir.test_station_id
      LEFT JOIN testing_routes tr       ON tr.item_type_id = i.item_type_id and tr.route_number = ir.route_number
      LEFT JOIN test_stations_type tst  ON tst.test_station_type_id = ANY(tr.route_steps)
      WHERE i.item_id = ${itemIdBig}
      ORDER BY i.item_id DESC
      LIMIT 1
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          i.item_id,
          i.serial_no,
          it.item_type_desc,
          ir.current_status,
          s.item_status_desc,
          CASE
              WHEN i.item_id = (SELECT COALESCE(parent_item_id, item_id) FROM items WHERE item_id = ${itemIdBig}) THEN 'Parent'
              ELSE 'Child'
          END as relation_type
        FROM items i
        JOIN item_types it ON i.item_type_id = it.item_type_id
        LEFT JOIN item_routes ir ON i.item_id = ir.item_id
        LEFT JOIN item_status s ON ir.current_status = s.item_status_id
        WHERE
          (
              i.parent_item_id = (SELECT CASE WHEN parent_item_id IS NOT NULL THEN parent_item_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
              OR
              i.item_id = (SELECT CASE WHEN parent_item_id IS NOT NULL THEN parent_item_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
          )
          AND i.item_id != ${itemIdBig}
      `,
      prisma.$queryRaw<any[]>`
        SELECT
          h.*,
          -- The station the step actually ran at, plus its type. The history row
          -- only stores test_station_id; the item-history screen needs the name
          -- ("איפה נעצר הפריט") and the type to line steps up with route_steps.
          TRIM(ts.test_station_desc) AS test_station_desc,
          ts.test_station_type_id,
          TRIM(tst.test_type_desc)  AS test_station_type_desc
        FROM item_route_history h
        LEFT JOIN test_stations ts       ON ts.test_station_id = h.test_station_id
        LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
        WHERE h.item_id = ${itemIdBig}
        ORDER BY h.log_id DESC
        LIMIT 200
      `,
      // worker_id here is a Keycloak employeeNumber (no local `workers` table
      // left to join against) — resolve names from the directory instead.
      getWorkersDirectory().catch(() => []),
    ]);

    const normalizedItem = itemResult[0] ? {
      ...itemResult[0],
      connected_items: connectedResult,
      created_at: normalizeToUtcIso(itemResult[0].created_at),
      finished_at: normalizeToUtcIso(itemResult[0].finished_at),
    } : null;

    const workerNameById = new Map(workersDirectory.map((w) => [w.worker_id, w.worker_name]));
    const normalizedHistory = historyResult.map((row: any) => ({
      ...row,
      worker_name: row.worker_id != null ? (workerNameById.get(Number(row.worker_id)) ?? null) : null,
      queue_start_time: normalizeToUtcIso(row.queue_start_time),
      processing_start_time: normalizeToUtcIso(row.processing_start_time),
      processing_end_time: normalizeToUtcIso(row.processing_end_time),
    }));

    return NextResponse.json(serializeBigInts({
      item: normalizedItem,
      history: normalizedHistory,
    }));
  } catch (error) {
    console.error("Error loading item:", error);
    return NextResponse.json({
      item: null,
      history: [],
    });
  }
}

// PUT: update the editable base fields of an item. The barcode (item_id) and
// the status/progress fields (owned by item_routes, driven by the testing
// workflow) are intentionally not accepted here.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    const body = await req.json();
    const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo, shipment } = body;

    if (!customer || !itemType || !serialNumber || !makat || !model || !manufacturer || !shipment) {
      return NextResponse.json({ error: "יש למלא את כל השדות" }, { status: 400 });
    }

    const updated = await prisma.items.update({
      where: { item_id: itemIdBig },
      data: {
        customer_id: Number(customer),
        item_type_id: Number(itemType),
        serial_no: String(serialNumber),
        makat: String(makat),
        model: String(model),
        manufacturer_name: String(manufacturer),
        manufacturer_no: manufacturerNo != null ? String(manufacturerNo) : "",
        shipment_id: Number(shipment),
      },
    });

    return NextResponse.json({ ok: true, item_id: updated.item_id.toString() });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "הפריט לא נמצא" }, { status: 404 });
    }
    console.error("Error updating item:", error);
    return NextResponse.json({ error: error.message || "עדכון הפריט נכשל" }, { status: 500 });
  }
}

// DELETE: remove an item and everything owned solely by it (route state,
// station history, test results — these have no DB-level FK to `items`, so
// they'd otherwise be left orphaned).
//
// If the item has connected accessory items (items.parent_item_id → this
// item — a real FK), deleting it outright would fail. Instead: without
// `cascade: true` in the body, report the connected items back as a 409 so
// the UI can warn the user by name; with `cascade: true`, delete the item
// and its connected items together in one transaction.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    let cascade = false;
    try {
      const body = await req.json();
      cascade = !!body?.cascade;
    } catch {
      // no JSON body sent — plain delete, cascade stays false
    }

    const children = await prisma.items.findMany({
      where: { parent_item_id: itemIdBig },
      select: { item_id: true, serial_no: true, model: true },
    });

    if (children.length > 0 && !cascade) {
      return NextResponse.json(
        {
          error: "לפריט זה יש פריטים מחוברים",
          connectedItems: children.map((c) => ({
            item_id: c.item_id.toString(),
            serial_no: c.serial_no,
            model: c.model,
          })),
        },
        { status: 409 }
      );
    }

    const idsToDelete = [itemIdBig, ...children.map((c) => c.item_id)];

    await prisma.$transaction(async (tx) => {
      await tx.test_results.deleteMany({ where: { item_id: { in: idsToDelete } } });
      await tx.item_route_history.deleteMany({ where: { item_id: { in: idsToDelete } } });
      await tx.item_routes.deleteMany({ where: { item_id: { in: idsToDelete } } });
      // Connected items first — they hold the FK (parent_item_id) to the main item.
      if (children.length > 0) {
        await tx.items.deleteMany({ where: { item_id: { in: children.map((c) => c.item_id) } } });
      }
      await tx.items.delete({ where: { item_id: itemIdBig } });
    });

    return NextResponse.json({ ok: true, deletedConnectedCount: children.length });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "הפריט לא נמצא" }, { status: 404 });
    }
    console.error("Error deleting item:", error);
    return NextResponse.json({ error: "מחיקת הפריט נכשלה" }, { status: 500 });
  }
}
