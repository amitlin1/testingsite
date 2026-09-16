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
import { PackageError } from "@/app/lib/packages/errors";
import { loadPackageContext } from "@/app/lib/packages/context";
import { checkItemRouteAgainstPackage, loadPackageLevelTypeIds, loadRouteShape } from "@/app/lib/packages/route-rules";
import { recheckPackageReadiness } from "@/app/lib/packages/readiness";
import { resetPackageToOpening } from "@/app/lib/packages/reset";
import { loadPackage } from "@/app/lib/packages/read";

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
          i.package_id,
          i.package_seq,
          COALESCE(i.is_package, false) AS is_package,
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
              WHEN i.item_id = (SELECT COALESCE(package_id, item_id) FROM items WHERE item_id = ${itemIdBig}) THEN 'Parent'
              ELSE 'Child'
          END as relation_type
        FROM items i
        JOIN item_types it ON i.item_type_id = it.item_type_id
        LEFT JOIN item_routes ir ON i.item_id = ir.item_id
        LEFT JOIN item_status s ON ir.current_status = s.item_status_id
        WHERE
          (
              i.package_id = (SELECT CASE WHEN package_id IS NOT NULL THEN package_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
              OR
              i.item_id = (SELECT CASE WHEN package_id IS NOT NULL THEN package_id ELSE item_id END FROM items WHERE item_id = ${itemIdBig})
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

    // Package model (docs/packages/PLAN.md): the item's box — its own view
    // for a package row, the parent's for an item inside one, null for a
    // legacy loose item. Feeds the "המארז שלי" card on the item screens.
    let packageView = null;
    if (normalizedItem) {
      try {
        packageView = normalizedItem.package_id != null
          ? await loadPackage(BigInt(normalizedItem.package_id))
          : normalizedItem.is_package
            ? await loadPackage(itemIdBig)
            : null;
      } catch (e) {
        console.error("Error loading the item's package:", e);
      }
    }

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
      package: packageView,
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
//
// Package model (docs/packages/PLAN.md §4, "שינוי סוג"):
//   - a PACKAGE never changes type (delete and re-create instead);
//   - an item inside a box may not become a package type;
//   - retyping an item while its box is still at the opening step restarts
//     just that item, as before — its new route must still fit the box;
//   - retyping an item after the box was opened resets the WHOLE box to the
//     opening station, and only with `confirmPackageReset: true` in the body
//     (the UI shows the warning first; without it the answer is 409
//     PACKAGE_RESET_REQUIRED).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { itemId } = parseBarcode(id);
    const itemIdBig = BigInt(itemId);

    const body = await req.json();
    const { customer, itemType, serialNumber, makat, model, manufacturer, manufacturerNo } = body;
    const confirmPackageReset = body.confirmPackageReset === true;
    const workerId: number | null = typeof body.workerId === "number" ? body.workerId : null;
    const workerName: string | null =
      typeof body.workerName === "string" && body.workerName ? body.workerName : null;

    if (!customer || !itemType || !makat) {
      return NextResponse.json({ error: "יש למלא לקוח, סוג ומק\"ט" }, { status: 400 });
    }

    const nextTypeId = Number(itemType);

    const result = await prisma.$transaction(async (tx) => {
      const ctx = await loadPackageContext(tx, itemIdBig);
      if (!ctx) throw new PackageError("ITEM_NOT_FOUND", "הפריט לא נמצא", 404);

      // A package has no serial and may leave model / manufacturer empty; an
      // item inside a box must carry all of them, as before.
      if (!ctx.isPackage && (!serialNumber || !model || !manufacturer)) {
        throw new PackageError("MISSING_FIELDS", "יש למלא את כל השדות");
      }

      const route = await tx.item_routes.findUnique({
        where: { item_id: itemIdBig },
        select: { item_type_id: true },
      });

      const typeChanged = route != null && route.item_type_id !== nextTypeId;

      let nextTypeDesc = "";
      if (typeChanged) {
        const nextType = await tx.item_types.findUnique({
          where: { item_type_id: nextTypeId },
          select: { is_package: true, item_type_desc: true },
        });
        if (!nextType) throw new PackageError("ITEM_TYPE_NOT_FOUND", "סוג הפריט לא נמצא", 404);
        nextTypeDesc = nextType.item_type_desc.trim();
        if (ctx.isPackage) {
          throw new PackageError("PACKAGE_TYPE_LOCKED", "לא ניתן לשנות סוג של מארז — יש למחוק וליצור מחדש", 409);
        }
        if (nextType.is_package) {
          throw new PackageError("NESTED_PACKAGE", `${nextTypeDesc} הוא סוג מארז ולא יכול להיות פריט בתוך מארז`);
        }
      }

      const updated = await tx.items.update({
        where: { item_id: itemIdBig },
        data: {
          customer_id: Number(customer),
          item_type_id: nextTypeId,
          serial_no: ctx.isPackage ? (serialNumber ? String(serialNumber) : null) : String(serialNumber),
          makat: String(makat),
          model: String(model ?? ""),
          manufacturer_name: String(manufacturer ?? ""),
          manufacturer_no: manufacturerNo != null ? String(manufacturerNo) : "",
        },
      });

      let packageReset: string[] | null = null;

      if (typeChanged) {
        // Route 1 of the new type: a route_number is only meaningful within a
        // type, so the old one cannot be carried across. Same default the
        // intake form uses.
        const routeNum = 1;

        // Inside a box: the new route must start and end where the box's
        // route does (PLAN.md §4), or the item would leak out of the group.
        let packagePastOpening = false;
        if (ctx.packageId != null) {
          const pkgRoute = await tx.item_routes.findUnique({
            where: { item_id: ctx.packageId },
            select: { item_type_id: true, route_number: true, current_route_step: true, is_finished: true },
          });
          if (pkgRoute) {
            const packageLevel = await loadPackageLevelTypeIds(tx);
            const pkgShape = await loadRouteShape(tx, pkgRoute.item_type_id, pkgRoute.route_number);
            if (pkgShape) {
              const itemShape = await loadRouteShape(tx, nextTypeId, routeNum);
              const problem = checkItemRouteAgainstPackage(itemShape, pkgShape, packageLevel, routeNum);
              if (problem) throw new PackageError("ITEM_ROUTE_SHAPE", `${nextTypeDesc}: ${problem}`, 409);
            }
            packagePastOpening = pkgRoute.current_route_step > 1 || pkgRoute.is_finished;
          }
        }

        if (packagePastOpening && !confirmPackageReset) {
          throw new PackageError(
            "PACKAGE_RESET_REQUIRED",
            "שינוי הסוג יאפס את כל המארז ויחזיר אותו לעמדת הפתיחה — נדרש אישור",
            409,
          );
        }

        if (packagePastOpening && ctx.packageId != null) {
          // The whole box starts over. Write the new type onto the item's
          // route row first; the reset reads each row's current type.
          await tx.item_routes.update({
            where: { item_id: itemIdBig },
            data: { item_type_id: nextTypeId, route_number: routeNum },
          });
          const outcome = await resetPackageToOpening(tx, ctx.packageId, { reason: "retyped", workerId, workerName });
          packageReset = outcome.resetItemIds.map((x) => x.toString());
        } else {
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
            workerId,
            workerName,
            reason: "manual_override",
          });

          // An item that left the closing gate (its new route starts at the
          // opening) may have been the last one the box was waiting for.
          if (ctx.packageId != null) {
            await recheckPackageReadiness(tx, ctx.packageId, { workerId, workerName });
          }
        }
      }

      // Ledger: same transaction as the writes above, per §4.8.
      await resyncItemDims(tx, itemIdBig);

      return { item_id: updated.item_id.toString(), retyped: typeChanged, packageReset };
    });

    return NextResponse.json({ ok: true, item_id: result.item_id, retyped: result.retyped, packageReset: result.packageReset });
  } catch (error: any) {
    if (error instanceof PackageError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
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
// Package model (docs/packages/PLAN.md §4):
//   - deleting a PACKAGE deletes every item inside it (items.package_id → the
//     box is a real FK, so it could not be deleted alone anyway). Without
//     `cascade: true` in the body the items are reported back as a 409 so the
//     UI can list them; with it, the box and its items go in one transaction.
//   - deleting the LAST item inside a box is refused: an empty package is not
//     allowed — delete the package instead.
//   - after an item leaves a box, the box's closing gate is re-evaluated.
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

    const ctx = await loadPackageContext(prisma, itemIdBig);
    if (ctx?.packageId != null) {
      const siblings = await prisma.items.count({ where: { package_id: ctx.packageId } });
      if (siblings <= 1) {
        return NextResponse.json(
          {
            error: "זה הפריט האחרון במארז — יש למחוק את המארז במקום",
            code: "LAST_PACKAGE_ITEM",
            packageId: ctx.packageId.toString(),
          },
          { status: 409 },
        );
      }
    }

    const children = await prisma.items.findMany({
      where: { package_id: itemIdBig },
      select: { item_id: true, serial_no: true, model: true },
    });

    if (children.length > 0 && !cascade) {
      return NextResponse.json(
        {
          error: "למארז יש פריטים בתוכו — מחיקתו תמחק גם אותם",
          code: "PACKAGE_HAS_ITEMS",
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
      // Items inside the box first — they hold the FK (package_id) to it.
      if (children.length > 0) {
        await tx.items.deleteMany({ where: { item_id: { in: children.map((c) => c.item_id) } } });
      }
      await tx.items.delete({ where: { item_id: itemIdBig } });

      // One item fewer to wait for: the box may be ready for closing now.
      if (ctx?.packageId != null) {
        await recheckPackageReadiness(tx, ctx.packageId, {});
      }
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
