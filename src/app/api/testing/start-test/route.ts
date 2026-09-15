import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getCurrentUtcIso } from "@/app/lib/datetime";
import { recordTransition } from "@/app/lib/metrics/record";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { isPackageLevelStationType, loadPackageContext } from "@/app/lib/packages/context";

export const runtime = "nodejs";

/**
 * API endpoint to start a test (update status from 2 "waiting" to 1 "in test")
 * Also sets processing_start_time to current UTC time
 * Updates test_stations.status to 1 for the selected station
 */
export async function POST(req: Request) {
  // Write-path schema gate (§8 stage 3): refuse loudly when the DB is behind
  // this image, instead of failing mid-transaction with an opaque 500.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json();
    const { itemId, stationId } = body;
    // Acting worker, snapshotted onto the event: this is what fills
    // entered_by_worker_* on the testing/in_research interval. Keycloak users
    // get deleted, so a bare id becomes unresolvable for old events (§3.3).
    const workerId: number | null =
      typeof body.workerId === "number" ? body.workerId : null;
    const workerName: string | null =
      typeof body.workerName === "string" && body.workerName ? body.workerName : null;

    if (!itemId || !stationId) {
      return NextResponse.json(
        { error: "itemId and stationId are required" },
        { status: 400 }
      );
    }

    // event_key = test_started:{action_uuid} (§4.4): the browser generates a
    // uuid per click so a client retry of the same click is a ledger no-op.
    // Fallback for clients not yet sending it: a server uuid keeps the route
    // working (retry idempotency then rests on the status guard alone).
    const actionUuid: string =
      typeof body.actionUuid === "string" && body.actionUuid ? body.actionUuid : randomUUID();

    // Get current UTC time as ISO string, then convert to Date for PostgreSQL
    const currentUtcIso = getCurrentUtcIso();
    const currentUtcDate = new Date(currentUtcIso);

    const result = await prisma.$transaction(async (tx) => {
      // First, check if the station is a research station (is_research = true)
      const stationInfo = await tx.test_stations.findUnique({
        where: { test_station_id: stationId },
        select: { is_research: true, test_station_type_id: true },
      });

      if (!stationInfo) {
        throw new Error("STATION_NOT_FOUND");
      }

      const isResearchStation = stationInfo.is_research === true;

      // Determine the target status: 5 for research stations, 1 for normal stations
      const targetStatus = isResearchStation ? 5 : 1;

      // Check if item is waiting for research (status 4) or normal waiting (status 2)
      const existingRoute = await tx.item_routes.findFirst({
        where: {
          item_id: BigInt(itemId),
          current_status: { in: [2, 4] },
        },
        select: { route_number: true },
      });

      if (!existingRoute) {
        throw new Error("ITEM_NOT_FOUND_OR_NOT_WAITING");
      }

      const routeNumber = existingRoute.route_number;

      // 1. Update item_routes: status to targetStatus, set processing_start_time, update test_station_id
      const updateResult = await tx.$queryRaw<any[]>`
        UPDATE item_routes
        SET current_status = ${targetStatus},
            processing_start_time = ${currentUtcDate}::timestamp,
            test_station_id = ${stationId}
        WHERE item_id = ${BigInt(itemId)}
          AND route_number = ${routeNumber}
          AND (current_status = 2 OR current_status = 4)
        RETURNING item_id, current_status, processing_start_time, test_station_id, current_route_step
      `;

      if (!updateResult || updateResult.length === 0) {
        throw new Error("ITEM_NOT_FOUND_OR_NOT_WAITING");
      }

      // 2. Update test_stations.status to 1 for the selected station
      await tx.test_stations.update({
        where: { test_station_id: stationId },
        data: { status: 1 },
      });

      // 3. Metrics ledger, call site #2 (§4.5): test_started → testing /
      // in_research, in the SAME transaction as the item_routes UPDATE (§4.8).
      // Station identity comes from the updated DB row's RETURNING, not from
      // the request body; occurred_at is assigned by the DB.
      await recordTransition(tx, {
        eventKey: `test_started:${actionUuid}`,
        itemId: BigInt(itemId),
        toState: isResearchStation ? "in_research" : "testing",
        stepNo: updateResult[0].current_route_step,
        stationId: updateResult[0].test_station_id,
        stationTypeId: stationInfo.test_station_type_id,
        workerId,
        workerName,
        reason: "test_started",
      });

      // 4. Group start (docs/packages/PLAN.md §4): starting a PACKAGE at a
      // package-level station starts every item inside it that is waiting
      // for this station type — the wizard tests them in the same session,
      // and package-level queues never list them, so nothing else would. Each
      // gets its own test_started, keyed by the same click + its own id, so
      // the ledger holds a real testing interval per item (no synthetic pair).
      let startedPackageItems: string[] = [];
      const pkgCtx = await loadPackageContext(tx, BigInt(itemId));
      if (
        pkgCtx?.isPackage &&
        !isResearchStation &&
        (await isPackageLevelStationType(tx, stationInfo.test_station_type_id))
      ) {
        const members = await tx.$queryRaw<{ item_id: bigint; current_route_step: number }[]>`
          UPDATE item_routes ir
             SET current_status = 1,
                 processing_start_time = ${currentUtcDate}::timestamp,
                 test_station_id = ${stationId}
            FROM items i, testing_routes tr
           WHERE i.item_id = ir.item_id
             AND i.package_id = ${BigInt(itemId)}
             AND tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
             AND ir.current_status = 2
             AND ir.finished_at IS NULL
             AND tr.route_steps[ir.current_route_step] = ${stationInfo.test_station_type_id}
          RETURNING ir.item_id, ir.current_route_step
        `;
        for (const m of members) {
          await recordTransition(tx, {
            eventKey: `test_started:${actionUuid}:${m.item_id}`,
            itemId: m.item_id,
            toState: "testing",
            stepNo: m.current_route_step,
            stationId,
            stationTypeId: stationInfo.test_station_type_id,
            workerId,
            workerName,
            reason: "test_started",
            payload: { package_id: String(itemId), group_start: true },
          });
        }
        startedPackageItems = members.map((m) => m.item_id.toString());
      }

      return { ...updateResult[0], startedPackageItems };
    });

    // Normalize processing_start_time to UTC ISO string
    // item_id is returned as BigInt by Prisma ($queryRaw + PostgreSQL BIGINT),
    // which JSON.stringify cannot serialize — convert to string.
    const normalizedRow = {
      ...result,
      item_id: result.item_id?.toString(),
      processing_start_time: result.processing_start_time
        ? new Date(result.processing_start_time).toISOString()
        : null,
    };

    return NextResponse.json({
      ok: true,
      item: normalizedRow,
    });
  } catch (error: any) {
    if (error.message === "STATION_NOT_FOUND") {
      return NextResponse.json(
        { error: "Station not found" },
        { status: 404 }
      );
    }
    if (error.message === "ITEM_NOT_FOUND_OR_NOT_WAITING") {
      return NextResponse.json(
        { error: "Item not found or not in waiting status" },
        { status: 404 }
      );
    }
    console.error("Error starting test:", error);
    return NextResponse.json(
      { error: "Failed to start test" },
      { status: 500 }
    );
  }
}
