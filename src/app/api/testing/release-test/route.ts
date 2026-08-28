import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { recordTransition } from "@/app/lib/metrics/record";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";

export const runtime = "nodejs";

/**
 * API endpoint to release a test that was started but abandoned before a
 * result was submitted (dialog closed / cancelled). Reverses start-test:
 * status 1 → 2 (waiting), 5 → 4 (waiting for research). No-ops if the item
 * already moved on (e.g. a result was submitted in the same moment the
 * client sent this), since the WHERE only matches the in-test/in-research row.
 */
export async function POST(req: Request) {
  // Write-path schema gate (§8 stage 3): refuse loudly when the DB is behind
  // this image, instead of failing mid-transaction with an opaque 500.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body = await req.json();
    const { itemId, stationId } = body;
    // Who released it — recorded on the event for the audit trail. The
    // queued interval it opens is a WAITING state, so isi_apply_one
    // deliberately leaves entered_by_worker_* NULL there; the name still
    // lives on the event itself.
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

    // event_key = released_by_user:{action_uuid} (§4.4). Fallback for clients
    // not yet sending one: a server uuid keeps the route working (the WHERE
    // current_status guard already makes a duplicate release a no-op anyway).
    const actionUuid: string =
      typeof body.actionUuid === "string" && body.actionUuid ? body.actionUuid : randomUUID();

    await prisma.$transaction(async (tx) => {
      const stationInfo = await tx.test_stations.findUnique({
        where: { test_station_id: stationId },
        select: { is_research: true, test_station_type_id: true },
      });
      if (!stationInfo) throw new Error("STATION_NOT_FOUND");

      const isResearch = stationInfo.is_research === true;
      const fromStatus = isResearch ? 5 : 1;
      const toStatus = isResearch ? 4 : 2;

      const released = await tx.$queryRaw<{ item_id: bigint; current_route_step: number }[]>`
        UPDATE item_routes
        SET current_status = ${toStatus},
            processing_start_time = NULL,
            queue_start_time = NOW()
        WHERE item_id = ${BigInt(itemId)}
          AND current_status = ${fromStatus}
        RETURNING item_id, current_route_step
      `;

      if (released.length > 0) {
        await tx.test_stations.update({
          where: { test_station_id: stationId },
          data: { status: 2 },
        });

        // Metrics ledger, call site #3 (§4.5): released_by_user → queued /
        // queued_research, in the SAME transaction as the item_routes UPDATE
        // (§4.8). A queued interval's station_type_id is the type the item is
        // still waiting for; queued_research carries NULL by definition (§3.6).
        // station_id is NULL for waiting states — no one "performs" waiting.
        await recordTransition(tx, {
          eventKey: `released_by_user:${actionUuid}`,
          itemId: BigInt(itemId),
          toState: isResearch ? "queued_research" : "queued",
          stepNo: released[0].current_route_step,
          stationTypeId: isResearch ? null : stationInfo.test_station_type_id,
          workerId,
          workerName,
          reason: "released_by_user",
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error.message === "STATION_NOT_FOUND") {
      return NextResponse.json({ error: "Station not found" }, { status: 404 });
    }
    console.error("Error releasing test:", error);
    return NextResponse.json({ error: "Failed to release test" }, { status: 500 });
  }
}
