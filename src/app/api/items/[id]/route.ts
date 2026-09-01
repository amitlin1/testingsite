import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { parseBarcode } from "@/app/lib/barcode-parser";
import { getWorkersDirectory } from "@/lib/keycloak-admin";
import { randomUUID } from "crypto";
import { findStationForRouteStep } from "@/app/lib/station-assignment";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { recordTransition } from "@/app/lib/metrics/record";
import { forgetItem, resyncItemDims, abandonRun } from "@/app/lib/metrics/item-lifecycle";

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
          TRIM(tst.test_type_desc)  AS test_station_type_desc,
          -- Net work time of the step, on THE work clock: the same
          -- work_seconds_between() the metrics ledger uses, so the item screens
          -- and every dashboard number agree by construction. It used to be
          -- recomputed in the browser by calculateWorkDuration(), which had its
          -- own hardcoded 07:00-15:30 day, no lunch break and no weekend — a
          -- third definition that agreed with neither. The columns are
          -- timestamp-without-zone holding UTC (§7.1), hence AT TIME ZONE 'UTC'.
          -- The IS NOT NULL guard is load-bearing: LEAST/GREATEST ignore NULLs,
          -- so work_seconds_between(start, NULL) answers 0 — a step still in
          -- progress would read "took no time".
          CASE WHEN h.processing_start_time IS NOT NULL
                AND h.processing_end_time   IS NOT NULL
               THEN work_seconds_between(h.processing_start_time AT TIME ZONE 'UTC',
                                         h.processing_end_time   AT TIME ZONE 'UTC')
          END AS net_work_seconds
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
      // numeric(…) arrives as a string over the wire; NULL while the step is
      // still open stays NULL — "not finished yet" is not "took no time".
      net_work_seconds:
        row.net_work_seconds === null || row.net_work_seconds === undefined
          ? null
          : Number(row.net_work_seconds),
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

// PUT: update the editable base fields of an item. The barcode (item_id), the
// shipment, and the status/progress fields (owned by item_routes, driven by the
// testing workflow) are intentionally not accepted here.
//
// Changing the TYPE is not an edit of a field — it re-routes the item. A
// different type can have an entirely different set of stations, so the steps
// already walked mean nothing on the new route and the item starts over at step
// 1. That is three writes, in one transaction:
//
//   item_routes  goes back to the start: the new type, step 1, queued, and the
//                station that serves step 1 OF THE NEW ROUTE.
//   the ledger   abandons the open run (closed, but is_trusted = false, so it
//                is not counted as a completion) and opens a fresh one against
//                the new plan when the `queued` transition below is recorded.
//   items        carries the new type like any other field.
//
// For every other field it is an ordinary correction: the ledger freezes
// customer / shipment / serial onto each run and interval so no read query has
// to join items (§3.6), and metrics_resync_item_dims re-freezes them.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    const body = await req.json();
    const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo } = body;

    if (!customer || !itemType || !serialNumber || !makat || !model || !manufacturer) {
      return NextResponse.json({ error: "יש למלא את כל השדות" }, { status: 400 });
    }

    const nextTypeId = Number(itemType);

    const result = await prisma.$transaction(async (tx) => {
      const route = await tx.item_routes.findUnique({
        where: { item_id: itemIdBig },
        select: { item_type_id: true },
      });

      const typeChanged = route != null && route.item_type_id !== nextTypeId;

      const updated = await tx.items.update({
        where: { item_id: itemIdBig },
        data: {
          customer_id: Number(customer),
          item_type_id: nextTypeId,
          serial_no: String(serialNumber),
          makat: String(makat),
          model: String(model),
          manufacturer_name: String(manufacturer),
          manufacturer_no: manufacturerNo != null ? String(manufacturerNo) : "",
        },
      });

      if (typeChanged) {
        // Route 1 of the new type: a route_number is only meaningful within a
        // type, so the old one cannot be carried across. Same default
        // create-item.ts uses at intake.
        const routeNum = 1;
        const stationId = await findStationForRouteStep(tx, nextTypeId, routeNum, 1);
        const now = new Date(getCurrentUtcIso());

        await tx.item_routes.update({
          where: { item_id: itemIdBig },
          data: {
            item_type_id: nextTypeId,
            route_number: routeNum,
            current_route_step: 1,
            current_status: 2, // queued (metric_state.legacy_status_id)
            test_station_id: stationId,
            is_finished: false,
            finished_at: null,
            queue_start_time: now,
            processing_start_time: null,
          },
        });

        // Close the old run first: metrics_record reuses an OPEN run, and
        // route_run_one_open forbids a second one, so without this the new
        // transition would land back on the run built for the old type.
        await abandonRun(tx, itemIdBig, "retyped");

        // Reopens the run against the new plan (metrics_open_run reads the
        // item_routes row updated just above). station_type_id is the type the
        // fresh queued interval waits for — step 1 of the new route.
        const routeRow = await tx.testing_routes.findFirst({
          where: { item_type_id: nextTypeId, route_number: routeNum },
          select: { route_steps: true },
        });

        await recordTransition(tx, {
          eventKey: `retype:${itemId}:${randomUUID()}`,
          itemId: itemIdBig,
          toState: "queued",
          stepNo: 1,
          stationTypeId: routeRow?.route_steps?.[0] ?? null,
          reason: "manual_override",
        });
      }

      // Ledger: same transaction as the writes above, per §4.8.
      await resyncItemDims(tx, itemIdBig);

      return { item_id: updated.item_id.toString(), retyped: typeChanged };
    });

    return NextResponse.json({ ok: true, item_id: result.item_id, retyped: result.retyped });
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
      // Ledger first. The metrics tables hold no FK to `items` -- deliberately,
      // so that no read query has to join it -- which means deleting the item
      // raises nothing and simply strands its runs, events and intervals. The
      // stranded interval stays open, and every dashboard number goes on
      // counting an item that no longer exists. metrics_forget_item works off
      // item_id alone, so it is safe here, before the rows it accompanies are
      // gone, and it commits with them.
      for (const id of idsToDelete) {
        await forgetItem(tx, id);
      }

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
