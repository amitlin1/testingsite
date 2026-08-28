import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso, getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep, findBestResearchStation } from "@/app/lib/station-assignment";
import { metricsSchemaGate } from "@/app/lib/metrics/schema-gate";
import { recordTransition, recordNote } from "@/app/lib/metrics/record";


export const runtime = "nodejs";

type TestResultRequest = {
  ItemID: number;
  StationID: number;
  CurrentRouteStep: number;
  RouteStepsLength: number; // Length of route_steps array from testing_routes
  QueueStartTime: string;
  ProcessingStartTime: string | null;
  Result: number;
  Comments?: string;
  WorkerID?: number;
  // Snapshot of the acting worker's display name for the metrics ledger
  // (worker directory lives in Keycloak — no local table to resolve it from).
  WorkerName?: string;
  // Client-generated action UUID (§4.4): one per submit click, shared by every
  // ledger event this request emits, stable across retries of the same action.
  SubmitID?: string;
  sendToResearch?: boolean; // new flag for research
  returnToRoute?: boolean; // return to route (5→2)
  finishRoute?: boolean; // finish route (5→3)
  SentAt?: string;
  ReturnAt?: string;
  // Required for finished_item insert (when isLastStep)
  ItemTypeId: number;
  CreatedAt: string;
  // Overall pass/fail + station-type-specific structured payload (e.g. intake wizard).
  // Optional so the plain report dialog (which sends only Result) keeps working.
  Passed?: boolean;
  Details?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // Write-path schema gate (§8 stage 3): refuse loudly when the DB is behind
  // this image, instead of failing mid-transaction with an opaque 500.
  const schemaDenied = await metricsSchemaGate();
  if (schemaDenied) return schemaDenied;

  try {
    const body: TestResultRequest = await req.json();
    const {
      ItemID,
      StationID,
      Result,
      Comments,
      WorkerID,
      WorkerName,
      SubmitID,
      sendToResearch,
      returnToRoute,
      finishRoute,
      SentAt,
      ReturnAt,
      Passed,
      Details,
    } = body;
    // Route/timing fields may be omitted (e.g. the intake wizard submitting one
    // result per accessory, where the client doesn't hold each child's route data).
    // Resolve any missing ones from the DB before validating.
    let { CurrentRouteStep, RouteStepsLength, QueueStartTime, ProcessingStartTime, ItemTypeId, CreatedAt } = body;

    if (!ItemID || !StationID) {
      return NextResponse.json({ error: "ItemID and StationID are required" }, { status: 400 });
    }

    // submit_id for the ledger idempotency keys (§4.4). A malformed value is a
    // client bug — reject loudly rather than silently minting a new identity.
    // A missing one gets a server-side UUID so callers that predate the ledger
    // keep working; those requests lose retry idempotency (a network retry
    // becomes a fresh key), which the payload marker makes observable.
    if (SubmitID !== undefined && !UUID_RE.test(String(SubmitID))) {
      return NextResponse.json({ error: "SubmitID must be a UUID" }, { status: 400 });
    }
    const clientSubmitId = SubmitID ?? null;
    const submitId = clientSubmitId ?? randomUUID();
    const payloadBase = clientSubmitId ? {} : { server_generated_submit_id: true };

    if (CurrentRouteStep === undefined || RouteStepsLength === undefined || !QueueStartTime || !ItemTypeId || !CreatedAt) {
      const infoRows = await prisma.$queryRaw<any[]>`
        SELECT ir.current_route_step, ir.queue_start_time, ir.processing_start_time, ir.item_type_id, ir.created_at,
               COALESCE(array_length(tr.route_steps, 1), 0) AS route_len
        FROM item_routes ir
        LEFT JOIN testing_routes tr ON tr.item_type_id = ir.item_type_id AND tr.route_number = ir.route_number
        WHERE ir.item_id = ${BigInt(ItemID)}
      `;
      const info = infoRows[0];
      if (info) {
        if (CurrentRouteStep === undefined) CurrentRouteStep = info.current_route_step;
        if (RouteStepsLength === undefined) RouteStepsLength = Number(info.route_len) || 0;
        if (!QueueStartTime && info.queue_start_time) QueueStartTime = new Date(info.queue_start_time).toISOString();
        if (ProcessingStartTime === undefined) ProcessingStartTime = info.processing_start_time ? new Date(info.processing_start_time).toISOString() : null;
        if (!ItemTypeId) ItemTypeId = info.item_type_id;
        if (!CreatedAt && info.created_at) CreatedAt = new Date(info.created_at).toISOString();
      }
    }

    if (Result === undefined || CurrentRouteStep === undefined || !QueueStartTime || RouteStepsLength === undefined || RouteStepsLength <= 0) {
      return NextResponse.json(
        { error: "ItemID, StationID, CurrentRouteStep, RouteStepsLength (must be > 0), QueueStartTime, and Result are required" },
        { status: 400 }
      );
    }

    const isLastStep = false; // Will be re-determined after update

    if (isLastStep && (!ItemTypeId || !CreatedAt)) {
      return NextResponse.json(
        { error: "ItemTypeId and CreatedAt are required when finishing the last step" },
        { status: 400 }
      );
    }

    // Normalize timestamps to UTC ISO strings before inserting
    const sentAtUtc = SentAt ? normalizeToUtcIso(SentAt) : null;
    const returnAtUtc = ReturnAt ? normalizeToUtcIso(ReturnAt) : null;
    const queueStartTimeUtc = normalizeToUtcIso(QueueStartTime);
    const processingStartTimeUtc = ProcessingStartTime ? normalizeToUtcIso(ProcessingStartTime) : null;

    if (!queueStartTimeUtc) {
      return NextResponse.json(
        { error: "Invalid QueueStartTime" },
        { status: 400 }
      );
    }

    const currentUtcIso = getCurrentUtcIso();
    const currentUtcDate = new Date(currentUtcIso);
    const itemIdBig = BigInt(ItemID);

    // Main transaction: insert history, update item_routes, insert research_history,
    // update station, emit the ledger events, and (per §4.8) the next-station
    // recommendation with its "no continuation" finish paths — all ONE
    // transaction, so a done-write can never commit without its event.
    // Timeout raised above Prisma's 5s default because the recommendation
    // section (formerly post-commit) now runs inside the tx.
    const txResult = await prisma.$transaction(async (tx) => {
      // Get route_number and current_status from item_routes.
      //
      // FOR UPDATE is a LOCK-ORDER guarantee, not an optimisation. Every other
      // write path (start-test, release-test, the reaper, create-item) takes
      // the item_routes ROW lock first and metrics_record's per-item advisory
      // lock second. Call site #15 below emits BEFORE this handler's first
      // UPDATE, so without this it would take the advisory lock first and
      // invert the order — an accessory submit and a start-test on the same
      // item could then deadlock (ABBA). Taking the row lock here makes the
      // order identical everywhere; the UPDATEs below would have taken it
      // anyway, so nothing is held longer than before.
      const routeInfoRows = await tx.$queryRaw<any[]>`
        SELECT route_number, current_status
        FROM item_routes
        WHERE item_id = ${itemIdBig}
        FOR UPDATE
      `;

      if (routeInfoRows.length === 0) {
        throw new Error("ITEM_ROUTE_NOT_FOUND");
      }

      const routeNumber = routeInfoRows[0].route_number;
      const currentStatus = routeInfoRows[0].current_status;
      const isResearchStatus = currentStatus === 5;

      const shouldWriteToItemRouteHistory = !isResearchStatus || returnToRoute === true || finishRoute === true;
      const shouldWriteToResearchHistory = isResearchStatus || (currentStatus === 1 && sendToResearch === true);

      // Station type of the submitting station — resolved early because the
      // ledger events carry it, and the test_results insert below reuses it.
      const stationTypeRows = await tx.$queryRaw<any[]>`
        SELECT test_station_type_id FROM test_stations WHERE test_station_id = ${StationID}
      `;
      const testStationTypeId = stationTypeRows[0]?.test_station_type_id ?? null;

      // Call site #15 (§4.5/§4.7): an item submitted while still queued
      // (status 2 before the UPDATE) never went through start-test — the
      // intake wizard tests accessories under the parent, and accessories are
      // parents_only-hidden from station queues so start-test is never called
      // for them. Without a synthetic test_started the item would have no
      // `testing` interval, ever. Every later event in this tx shifts +1.
      const needsSyntheticStart = currentStatus === 2;
      const seqOffset = needsSyntheticStart ? 1 : 0;
      if (needsSyntheticStart) {
        await recordTransition(tx, {
          eventKey: `test_started:${submitId}:${ItemID}:0`,
          itemId: itemIdBig,
          toState: "testing",
          stepNo: CurrentRouteStep,
          stationId: StationID,
          stationTypeId: testStationTypeId,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "test_started",
          submitId,
          seq: 0,
          payload: { ...payloadBase, synthetic_pair: true },
        });
      }

      // The ledger event this submission's test_results row anchors to (#14):
      // whichever of #5/#6/#8/#9 fired, overwritten by #10 (or a #11 finish)
      // later in the tx; on the 5→5 interim path, the #7 note.
      let stateEventId: bigint | null = null;

      // 1. INSERT into item_route_history
      let historyLogId: any = null;
      if (shouldWriteToItemRouteHistory) {
        const historyRows = await tx.$queryRaw<any[]>`
          INSERT INTO item_route_history (
            item_id, test_station_id, current_route_step,
            queue_start_time, processing_start_time, processing_end_time,
            worker_id, route_number
          )
          VALUES (
            ${itemIdBig}, ${StationID}, ${CurrentRouteStep},
            ${queueStartTimeUtc ? new Date(queueStartTimeUtc) : null}::timestamp,
            ${processingStartTimeUtc ? new Date(processingStartTimeUtc) : null}::timestamp,
            ${currentUtcDate}::timestamp,
            ${WorkerID || null}, ${routeNumber}
          )
          RETURNING log_id
        `;
        historyLogId = historyRows[0]?.log_id || null;
      }

      // 2. Handle item_routes based on current status and action
      let updatedRouteStep: number | null = null;
      let updatedStatus: number | null = null;
      let updatedItemTypeId: number | null = null;

      if (isResearchStatus && returnToRoute === true) {
        // Return to route (5→2): don't touch current_route_step.
        // current_status = 5 is optimistic concurrency (same idea as the
        // current_route_step guard on the normal path): if a concurrent action
        // already moved the item out of research, this matches 0 rows instead
        // of blindly re-queuing it.
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 2, queue_start_time = ${currentUtcDate}::timestamp
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
            AND current_status = 5
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Call site #5 (§4.5): research over, re-queued at the SAME step
        // (attempt_no advances inside the DB). Station is NULL — a waiting
        // item's station is NULL by construction.
        stateEventId = await recordTransition(tx, {
          eventKey: `returned_to_route:${submitId}:${ItemID}:0`,
          itemId: itemIdBig,
          toState: "queued",
          stepNo: updatedRouteStep!,
          stationId: null,
          stationTypeId: null,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "returned_to_route",
          submitId,
          seq: 0,
          payload: payloadBase,
        });
      } else if (isResearchStatus && finishRoute === true) {
        // Finish route (5→3): don't touch current_route_step.
        // current_status = 5 — optimistic guard, see returnToRoute above.
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 3, finished_at = ${currentUtcDate}::timestamp, is_finished = true
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
            AND current_status = 5
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Call site #6 (§4.5): route finished out of research.
        stateEventId = await recordTransition(tx, {
          eventKey: `result_submitted:${submitId}:${ItemID}:0`,
          itemId: itemIdBig,
          toState: "done",
          stepNo: updatedRouteStep!,
          stationId: StationID,
          stationTypeId: testStationTypeId,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "result_submitted",
          submitId,
          seq: 0,
          payload: payloadBase,
        });
      } else if (isResearchStatus) {
        // Status 5 regular: don't update item_routes, only save in research_history
        updatedStatus = currentStatus;
        updatedRouteStep = CurrentRouteStep;
        const itemTypeRows = await tx.$queryRaw<any[]>`
          SELECT item_type_id FROM item_routes WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
        `;
        updatedItemTypeId = itemTypeRows[0]?.item_type_id || ItemTypeId;

        // Call site #7 (§4.5): interim research save (5→5) — a note; the
        // research interval stays open. test_results anchors to it (#14).
        stateEventId = await recordNote(tx, {
          eventKey: `research_note:${submitId}:${ItemID}`,
          itemId: itemIdBig,
          stepNo: CurrentRouteStep,
          stationId: StationID,
          stationTypeId: testStationTypeId,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "research_note",
          submitId,
          seq: 0,
          payload: payloadBase,
        });
      } else if (sendToResearch === true) {
        // Send to research: don't increment current_route_step, set status to 4.
        // current_status = 1 — optimistic guard: sendToResearch is only valid
        // from "in test"; a duplicate submit (item already 4) matches 0 rows.
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 4, queue_start_time = ${currentUtcDate}::timestamp, processing_start_time = NULL
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
            AND current_status = 1
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Call site #8 (§4.5): diverted to the research queue; the step does
        // not advance — the diversion itself is what's marked.
        stateEventId = await recordTransition(tx, {
          eventKey: `sent_to_research:${submitId}:${ItemID}:0`,
          itemId: itemIdBig,
          toState: "queued_research",
          stepNo: updatedRouteStep!,
          stationId: null,
          stationTypeId: null,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "sent_to_research",
          submitId,
          seq: 0,
          payload: payloadBase,
        });

        // Assign test_station_id to the best research station
        const researchStationId = await findBestResearchStation(tx);
        if (researchStationId !== null) {
          await tx.$executeRaw`
            UPDATE item_routes SET test_station_id = ${researchStationId}
            WHERE item_id = ${itemIdBig} AND route_number = ${updateRows[0].route_number} AND finished_at IS NULL
          `;
          // Call site #12, site :206 (findBestResearchStation) — seq=3, §4.5.
          // Explicit per-site seq: two reassignments in one submit must not
          // collapse into one event_key.
          await recordNote(tx, {
            eventKey: `station_reassigned:${submitId}:${ItemID}:3`,
            itemId: itemIdBig,
            stepNo: updatedRouteStep!,
            stationId: researchStationId,
            workerId: WorkerID ?? null,
            workerName: WorkerName ?? null,
            reason: "station_reassigned",
            submitId,
            seq: 3,
            payload: { ...payloadBase, station_id: researchStationId, site: "find_best_research_station" },
          });
        }
      } else {
        // Status 1: existing logic - increment current_route_step
        // The current_route_step check is optimistic concurrency: it stops a
        // duplicate submission for the same step (e.g. two workers who both
        // had the item's wizard open at once) from advancing the route twice —
        // the second submit's CurrentRouteStep no longer matches the row the
        // first submit already advanced, so it matches 0 rows and fails below.
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 2, current_route_step = current_route_step + 1, queue_start_time = ${currentUtcDate}::timestamp
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
            AND current_route_step = ${CurrentRouteStep}
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Call site #9 (§4.5): normal advance — queued for the NEXT step.
        // Station NULL by construction for a waiting item; seq shifts after #15.
        stateEventId = await recordTransition(tx, {
          eventKey: `result_submitted:${submitId}:${ItemID}:${seqOffset}`,
          itemId: itemIdBig,
          toState: "queued",
          stepNo: updatedRouteStep!,
          stationId: null,
          stationTypeId: null,
          workerId: WorkerID ?? null,
          workerName: WorkerName ?? null,
          reason: "result_submitted",
          submitId,
          seq: seqOffset,
          payload: payloadBase,
        });

        // Assign test_station_id for the new route step
        const updatedRouteNumber = updateRows[0].route_number;
        if (updatedItemTypeId && updatedRouteStep) {
          const nextStationId = await findStationForRouteStep(tx, updatedItemTypeId, updatedRouteNumber, updatedRouteStep);
          if (nextStationId !== null) {
            await tx.$executeRaw`
              UPDATE item_routes SET test_station_id = ${nextStationId}
              WHERE item_id = ${itemIdBig} AND route_number = ${updatedRouteNumber} AND finished_at IS NULL
            `;
            // Call site #12, site :235 (in-tx step assignment) — seq=2, §4.5.
            await recordNote(tx, {
              eventKey: `station_reassigned:${submitId}:${ItemID}:2`,
              itemId: itemIdBig,
              stepNo: updatedRouteStep!,
              stationId: nextStationId,
              workerId: WorkerID ?? null,
              workerName: WorkerName ?? null,
              reason: "station_reassigned",
              submitId,
              seq: 2,
              payload: { ...payloadBase, station_id: nextStationId, site: "route_step_assignment" },
            });
          }
        }
      }

      // Validate we got the values
      if ((!isResearchStatus || returnToRoute === true || finishRoute === true) && (!updatedRouteStep || !updatedItemTypeId)) {
        throw new Error("FAILED_TO_UPDATE_ITEM_ROUTE");
      }

      // Check if this is the last step and mark as finished
      if (sendToResearch !== true && !(isResearchStatus && !returnToRoute && !finishRoute) && !(isResearchStatus && returnToRoute === true)) {
        if (updatedStatus !== 3) {
          // Check if the updated route_step points to a valid step in route_steps
          const checkRows = await tx.$queryRaw<any[]>`
            SELECT
              route_steps[${updatedRouteStep}] AS next_station_type_id,
              array_length(route_steps, 1) AS route_length
            FROM testing_routes
            WHERE item_type_id = ${updatedItemTypeId} AND route_number = ${routeNumber}
          `;

          const routeLength = checkRows[0]?.route_length || 0;
          const nextStationTypeId = checkRows[0]?.next_station_type_id;
          const isActuallyLastStep = !nextStationTypeId || (updatedRouteStep! > routeLength);

          if (isActuallyLastStep) {
            await tx.$executeRaw`
              UPDATE item_routes
              SET current_status = 3, finished_at = ${currentUtcDate}::timestamp, is_finished = true
              WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
            `;
            updatedStatus = 3;

            // Call site #10 (§4.5): last step — done, in the SAME tx as #9.
            // The seq keeps this key distinct from #9's (§4.4: the key carries
            // the transition identity, not just the human action).
            stateEventId = await recordTransition(tx, {
              eventKey: `result_submitted:${submitId}:${ItemID}:${1 + seqOffset}`,
              itemId: itemIdBig,
              toState: "done",
              stepNo: updatedRouteStep!,
              stationId: StationID,
              stationTypeId: testStationTypeId,
              workerId: WorkerID ?? null,
              workerName: WorkerName ?? null,
              reason: "result_submitted",
              submitId,
              seq: 1 + seqOffset,
              payload: payloadBase,
            });
          }
        }
      }

      // 3. INSERT into research_history
      let researchId: any = null;
      if (shouldWriteToResearchHistory) {
        const researchRows = await tx.$queryRaw<any[]>`
          INSERT INTO research_history (
            item_id, station_id, result, comments, worker_id, sent_at, return_at
          )
          VALUES (
            ${itemIdBig}, ${StationID}, ${Result}, ${Comments || null},
            ${WorkerID || null},
            ${sentAtUtc ? new Date(sentAtUtc) : null}::timestamp,
            ${returnAtUtc ? new Date(returnAtUtc) : null}::timestamp
          )
          RETURNING research_id
        `;
        researchId = researchRows[0]?.research_id || null;
      }

      // Persist the actual test result for THIS item (parent or accessory —
      // each is its own routed item). Additive: item_route_history keeps the
      // route/timing log; this row holds the result value + structured details.
      // state_event_id anchors the result to its ledger event (call site #14)
      // so Q8 can join pass/fail onto state intervals.
      await tx.$executeRaw`
        INSERT INTO test_results (
          item_id, test_station_id, test_station_type_id, route_number, route_step,
          worker_id, passed, result, comments, details, state_event_id
        )
        VALUES (
          ${itemIdBig}, ${StationID}, ${testStationTypeId}, ${routeNumber}, ${CurrentRouteStep},
          ${WorkerID || null}, ${Passed ?? null}, ${Result}, ${Comments || null},
          ${Details != null ? JSON.stringify(Details) : null}::jsonb,
          ${stateEventId}
        )
      `;

      // Update test_stations status to 2 (Available/Waiting)
      await tx.test_stations.update({
        where: { test_station_id: StationID },
        data: { status: 2 },
      });

      // 4. Calculate research station recommendation if sendToResearch
      let recommendedResearchStation: any = null;
      if (sendToResearch === true) {
        // Only the RECOMMENDATION QUERY is best-effort. The writes it implies
        // (the station assignment and its ledger note) are NOT: they used to
        // sit inside this catch, so a failing note left the transaction poisoned
        // while the handler carried on toward a success shape. Read here, write
        // below, outside the guard.
        let researchStationRows: any[] = [];
        try {
          researchStationRows = await tx.$queryRaw<any[]>`
            WITH research_stations AS (
              SELECT ts.test_station_id, ts.test_station_desc, ts.test_station_type_id,
                     COALESCE(tst.test_type_desc, '') AS station_type_name
              FROM test_stations ts
              LEFT JOIN test_stations_type tst ON tst.test_station_type_id = ts.test_station_type_id
              WHERE ts.is_research = true AND ts.status != 3
            ),
            station_load AS (
              SELECT rs.test_station_id, rs.test_station_desc, rs.test_station_type_id, rs.station_type_name,
                     COUNT(CASE WHEN ir.current_status IN (4, 5) AND ir.finished_at IS NULL THEN 1 END) AS current_load
              FROM research_stations rs
              LEFT JOIN item_routes ir ON ir.test_station_id = rs.test_station_id AND ir.finished_at IS NULL AND ir.current_status IN (4, 5)
              GROUP BY rs.test_station_id, rs.test_station_desc, rs.test_station_type_id, rs.station_type_name
            )
            SELECT test_station_id, test_station_desc, test_station_type_id, station_type_name, current_load
            FROM station_load
            ORDER BY current_load ASC, RANDOM()
            LIMIT 1
          `;
        } catch (researchError) {
          console.error("Error calculating research station:", researchError);
        }

        {
          if (researchStationRows.length > 0) {
            const station = researchStationRows[0];
            recommendedResearchStation = {
              stationId: station.test_station_id,
              stationDesc: (station.test_station_desc || "").trim(),
              stationTypeId: station.test_station_type_id,
              stationTypeName: (station.station_type_name || "").trim(),
              currentLoad: parseInt(station.current_load || "0", 10),
            };

            await tx.$executeRaw`
              UPDATE item_routes SET test_station_id = ${recommendedResearchStation.stationId}
              WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
            `;
            // Call site #12, site :353 (research load-balancing) — seq=2, §4.5.
            await recordNote(tx, {
              eventKey: `station_reassigned:${submitId}:${ItemID}:2`,
              itemId: itemIdBig,
              stepNo: updatedRouteStep ?? CurrentRouteStep,
              stationId: recommendedResearchStation.stationId,
              stationTypeId: recommendedResearchStation.stationTypeId ?? null,
              workerId: WorkerID ?? null,
              workerName: WorkerName ?? null,
              reason: "station_reassigned",
              submitId,
              seq: 2,
              payload: { ...payloadBase, station_id: recommendedResearchStation.stationId, site: "research_load_balancing" },
            });
          }
        }
      }

      // 5. Next-station recommendation. This whole section — including the
      // three "no continuation" finish paths (call site #11) and the
      // load-balancing reassignment (#12 :545) — used to run AFTER the main
      // commit in its own sub-transactions. Pulled into the main tx per §4.8
      // so a `done` write can never commit without its ledger event, and vice
      // versa. The reads see our own uncommitted writes — same data as before.
      let nextStationRecommendation: {
        isLastStation: boolean;
        nextStation?: {
          testStationId: number;
          testStationDesc: string;
          stationTypeId: number;
          routeStep: number;
        };
      } = { isLastStation: false };

      try {
        if (sendToResearch === true) {
          // The transaction already routed the item to a research station via
          // findBestResearchStation + recommendedResearchStation. Recomputing the
          // "next station" here would walk the regular route_steps and overwrite
          // test_station_id with a non-research station of the matching type
          // (the bug we just fixed). The frontend uses recommendedResearchStation
          // for the dialog, so nextStationRecommendation is unused on this path.
          nextStationRecommendation = { isLastStation: false };
        } else if (isResearchStatus && !returnToRoute && !finishRoute) {
          nextStationRecommendation = { isLastStation: true };
        } else if (!updatedStatus || updatedRouteStep === null) {
          nextStationRecommendation = { isLastStation: true };
        } else if (updatedStatus === 3) {
          nextStationRecommendation = { isLastStation: true };
        } else {
          if (!updatedItemTypeId) {
            nextStationRecommendation = { isLastStation: true };
          } else {
            const stepIndex = (isResearchStatus && returnToRoute === true) ? CurrentRouteStep : updatedRouteStep;

            const nextStationTypeResult = await tx.$queryRaw<any[]>`
              SELECT
                route_steps[${stepIndex}] AS next_station_type_id,
                array_length(route_steps, 1) AS route_length
              FROM testing_routes
              WHERE item_type_id = ${updatedItemTypeId} AND route_number = ${routeNumber}
            `;

            const nextRouteLength = nextStationTypeResult[0]?.route_length || 0;
            const nextStationTypeIdValue = nextStationTypeResult[0]?.next_station_type_id;

            if (
              nextStationTypeResult.length === 0 ||
              !nextStationTypeIdValue ||
              stepIndex > nextRouteLength
            ) {
              // No station type at this step — the route was shortened in
              // settings (classic case: returnToRoute onto a step that no
              // longer exists). Mark done. The finished_item INSERT that used
              // to sit here never once succeeded (wrong column name → 42703
              // rolled back the pair and was swallowed; §4.8) and finished_item
              // is being retired — only the UPDATE survives, now WITH its event.
              await tx.$executeRaw`
                UPDATE item_routes
                SET current_status = 3, finished_at = ${new Date(getCurrentUtcIso())}::timestamp, is_finished = true
                WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
              `;
              // Call site #11(a) (§4.5): shortened-route finish.
              await recordTransition(tx, {
                eventKey: `no_station_for_type:${submitId}:${ItemID}:${1 + seqOffset}`,
                itemId: itemIdBig,
                toState: "done",
                stepNo: stepIndex!,
                stationId: null,
                stationTypeId: null,
                workerId: WorkerID ?? null,
                workerName: WorkerName ?? null,
                reason: "no_station_for_type",
                submitId,
                seq: 1 + seqOffset,
                payload: { ...payloadBase, branch: "route_shortened" },
              });
              updatedStatus = 3;
              nextStationRecommendation = { isLastStation: true };
            } else {
              const nextStationTypeId = nextStationTypeResult[0].next_station_type_id;

              // Find all stations of this type with load calculation
              const stationsWithLoadResult = await tx.$queryRaw<any[]>`
                WITH candidate_stations AS (
                  SELECT ts.test_station_id, ts.test_station_desc, ts.test_station_type_id
                  FROM test_stations ts
                  WHERE ts.test_station_type_id = ${nextStationTypeId} AND ts.status != 3
                ),
                station_load AS (
                  SELECT cs.test_station_id, cs.test_station_desc,
                         COUNT(CASE WHEN ir.current_status = 2 AND ir.finished_at IS NULL THEN 1 END) AS waiting_count,
                         COUNT(CASE WHEN ir.current_status = 1 AND ir.finished_at IS NULL THEN 1 END) AS in_test_count
                  FROM candidate_stations cs
                  LEFT JOIN item_routes ir ON ir.test_station_id = cs.test_station_id AND ir.finished_at IS NULL AND ir.current_status IN (1, 2)
                  GROUP BY cs.test_station_id, cs.test_station_desc
                )
                SELECT test_station_id, test_station_desc, waiting_count, in_test_count,
                       (waiting_count + in_test_count) AS total_active
                FROM station_load
                ORDER BY waiting_count ASC, total_active ASC, test_station_id ASC
              `;

              if (stationsWithLoadResult.length === 0) {
                // No stations of this type exist at all — nothing can ever
                // test the item; mark it done.
                await tx.$executeRaw`
                  UPDATE item_routes
                  SET current_status = 3, finished_at = ${new Date(getCurrentUtcIso())}::timestamp
                  WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
                `;
                // Call site #11(b) (§4.5): no stations of the required type.
                await recordTransition(tx, {
                  eventKey: `no_station_for_type:${submitId}:${ItemID}:${1 + seqOffset}`,
                  itemId: itemIdBig,
                  toState: "done",
                  stepNo: stepIndex!,
                  stationId: null,
                  stationTypeId: nextStationTypeId,
                  workerId: WorkerID ?? null,
                  workerName: WorkerName ?? null,
                  reason: "no_station_for_type",
                  submitId,
                  seq: 1 + seqOffset,
                  payload: { ...payloadBase, branch: "no_station_of_type" },
                });
                updatedStatus = 3;
                nextStationRecommendation = { isLastStation: true };
              } else {
                // Find stations with minimum waiting_count
                const minWaitingCount = Number(stationsWithLoadResult[0].waiting_count) || 0;
                const stationsWithMinWaiting = stationsWithLoadResult.filter(
                  (row: any) => (Number(row.waiting_count) || 0) === minWaitingCount
                );

                if (stationsWithMinWaiting.length === 0) {
                  nextStationRecommendation = { isLastStation: true };
                } else {
                  const totalActiveValues = stationsWithMinWaiting.map((row: any) => Number(row.total_active) || 0);
                  const minTotalActive = Math.min(...totalActiveValues);
                  const stationsWithMinLoad = stationsWithMinWaiting.filter(
                    (row: any) => (Number(row.total_active) || 0) === minTotalActive
                  );

                  if (stationsWithMinLoad.length === 0) {
                    nextStationRecommendation = { isLastStation: true };
                  } else {
                    const randomIndex = Math.floor(Math.random() * stationsWithMinLoad.length);
                    const selectedStation = stationsWithMinLoad[randomIndex];

                    if (!selectedStation || !selectedStation.test_station_id) {
                      console.error("Invalid selected station:", selectedStation);
                      nextStationRecommendation = { isLastStation: true };
                    } else {
                      // Update item_routes with the selected test_station_id
                      await tx.$executeRaw`
                        UPDATE item_routes
                        SET test_station_id = ${selectedStation.test_station_id}
                        WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
                      `;
                      // Call site #12, site :545 (load-balancing) — seq=3, §4.5.
                      await recordNote(tx, {
                        eventKey: `station_reassigned:${submitId}:${ItemID}:3`,
                        itemId: itemIdBig,
                        stepNo: stepIndex!,
                        stationId: selectedStation.test_station_id,
                        stationTypeId: nextStationTypeId,
                        workerId: WorkerID ?? null,
                        workerName: WorkerName ?? null,
                        reason: "station_reassigned",
                        submitId,
                        seq: 3,
                        payload: { ...payloadBase, station_id: selectedStation.test_station_id, site: "next_station_load_balancing" },
                      });

                      nextStationRecommendation = {
                        isLastStation: false,
                        nextStation: {
                          testStationId: selectedStation.test_station_id,
                          testStationDesc: (selectedStation.test_station_desc || "").trim(),
                          stationTypeId: nextStationTypeId,
                          routeStep: stepIndex,
                        },
                      };
                    }
                  }
                }
              }
            }
          }
        }
      } catch (calcError: any) {
        console.error("Error calculating next station recommendation:", calcError);

        // Call site #11(c) (§4.5): the error fallback — mark the item finished
        // WITH its event, in the same tx. If the tx itself is already aborted
        // (a failed SQL statement above) these writes rethrow and the whole
        // submission rolls back atomically — exactly the §4.8 guarantee;
        // previously this fallback ran in a fresh post-commit transaction and
        // could finish an item whose ledger never heard about it.
        if (ItemID && routeNumber && updatedItemTypeId) {
          await tx.$executeRaw`
            UPDATE item_routes
            SET current_status = 3, finished_at = ${new Date(getCurrentUtcIso())}::timestamp
            WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
          `;
          await recordTransition(tx, {
            eventKey: `no_station_for_type:${submitId}:${ItemID}:${1 + seqOffset}`,
            itemId: itemIdBig,
            toState: "done",
            stepNo: updatedRouteStep ?? CurrentRouteStep,
            stationId: null,
            stationTypeId: null,
            workerId: WorkerID ?? null,
            workerName: WorkerName ?? null,
            reason: "no_station_for_type",
            submitId,
            seq: 1 + seqOffset,
            payload: { ...payloadBase, branch: "calc_error" },
          });
          updatedStatus = 3;
        }

        nextStationRecommendation = { isLastStation: true };
      }

      return {
        historyLogId,
        researchId,
        updatedStatus,
        updatedRouteStep,
        updatedItemTypeId,
        routeNumber,
        isResearchStatus,
        recommendedResearchStation,
        nextStationRecommendation,
      };
    }, { maxWait: 5000, timeout: 15000 });

    const responseData: any = {
      ok: true,
      success: true,
      researchId: txResult.researchId,
      logId: txResult.historyLogId,
      isLastStep,
      ...txResult.nextStationRecommendation,
    };

    if (txResult.recommendedResearchStation) {
      responseData.recommendedResearchStation = txResult.recommendedResearchStation;
    }

    return NextResponse.json(responseData);
  } catch (error: any) {
    if (error.message === "ITEM_ROUTE_NOT_FOUND") {
      return NextResponse.json(
        { error: "Item route not found" },
        { status: 404 }
      );
    }
    if (error.message === "ITEM_ROUTE_NOT_FOUND_OR_FINISHED") {
      return NextResponse.json(
        { error: "Item route not found or already finished" },
        { status: 404 }
      );
    }
    if (error.message === "FAILED_TO_UPDATE_ITEM_ROUTE") {
      return NextResponse.json(
        { error: "Failed to update item route" },
        { status: 500 }
      );
    }
    console.error("Error saving test result:", error);
    const errorMessage = error?.message || error?.detail || "Failed to save test result";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
