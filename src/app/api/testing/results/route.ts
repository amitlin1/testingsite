import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso, getCurrentUtcIso } from "@/app/lib/datetime";
import { findStationForRouteStep, findBestResearchStation } from "@/app/lib/station-assignment";


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
  sendToResearch?: boolean; // new flag for research
  returnToRoute?: boolean; // return to route (5→2)
  finishRoute?: boolean; // finish route (5→3)
  SentAt?: string;
  ReturnAt?: string;
  // Required for finished_item insert (when isLastStep)
  ItemTypeId: number;
  CreatedAt: string;
};

export async function POST(req: Request) {
  try {
    const body: TestResultRequest = await req.json();
    const {
      ItemID,
      StationID,
      CurrentRouteStep,
      RouteStepsLength,
      QueueStartTime,
      ProcessingStartTime,
      Result,
      Comments,
      WorkerID,
      sendToResearch,
      returnToRoute,
      finishRoute,
      SentAt,
      ReturnAt,
      ItemTypeId,
      CreatedAt,
    } = body;

    if (!ItemID || !StationID || Result === undefined || CurrentRouteStep === undefined || !QueueStartTime || RouteStepsLength === undefined || RouteStepsLength <= 0) {
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

    // Main transaction: insert history, update item_routes, insert research_history, update station
    const txResult = await prisma.$transaction(async (tx) => {
      // Get route_number and current_status from item_routes
      const routeInfoRows = await tx.$queryRaw<any[]>`
        SELECT route_number, current_status
        FROM item_routes
        WHERE item_id = ${itemIdBig}
      `;

      if (routeInfoRows.length === 0) {
        throw new Error("ITEM_ROUTE_NOT_FOUND");
      }

      const routeNumber = routeInfoRows[0].route_number;
      const currentStatus = routeInfoRows[0].current_status;
      const isResearchStatus = currentStatus === 5;

      const shouldWriteToItemRouteHistory = !isResearchStatus || returnToRoute === true || finishRoute === true;
      const shouldWriteToResearchHistory = isResearchStatus || (currentStatus === 1 && sendToResearch === true);

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
        // Return to route (5→2): don't touch current_route_step
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 2, queue_start_time = ${currentUtcDate}::timestamp
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;
      } else if (isResearchStatus && finishRoute === true) {
        // Finish route (5→3): don't touch current_route_step
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 3, finished_at = ${currentUtcDate}::timestamp, is_finished = true
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;
      } else if (isResearchStatus) {
        // Status 5 regular: don't update item_routes, only save in research_history
        updatedStatus = currentStatus;
        updatedRouteStep = CurrentRouteStep;
        const itemTypeRows = await tx.$queryRaw<any[]>`
          SELECT item_type_id FROM item_routes WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
        `;
        updatedItemTypeId = itemTypeRows[0]?.item_type_id || ItemTypeId;
      } else if (sendToResearch === true) {
        // Send to research: don't increment current_route_step, set status to 4
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 4, queue_start_time = ${currentUtcDate}::timestamp, processing_start_time = NULL
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Assign test_station_id to the best research station
        const researchStationId = await findBestResearchStation(tx);
        if (researchStationId !== null) {
          await tx.$executeRaw`
            UPDATE item_routes SET test_station_id = ${researchStationId}
            WHERE item_id = ${itemIdBig} AND route_number = ${updateRows[0].route_number} AND finished_at IS NULL
          `;
        }
      } else {
        // Status 1: existing logic - increment current_route_step
        const updateRows = await tx.$queryRaw<any[]>`
          UPDATE item_routes
          SET current_status = 2, current_route_step = current_route_step + 1, queue_start_time = ${currentUtcDate}::timestamp
          WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
          RETURNING current_status, current_route_step, item_type_id, route_number
        `;
        if (updateRows.length === 0) throw new Error("ITEM_ROUTE_NOT_FOUND_OR_FINISHED");
        updatedStatus = updateRows[0].current_status;
        updatedRouteStep = updateRows[0].current_route_step;
        updatedItemTypeId = updateRows[0].item_type_id;

        // Assign test_station_id for the new route step
        const updatedRouteNumber = updateRows[0].route_number;
        if (updatedItemTypeId && updatedRouteStep) {
          const nextStationId = await findStationForRouteStep(tx, updatedItemTypeId, updatedRouteNumber, updatedRouteStep);
          if (nextStationId !== null) {
            await tx.$executeRaw`
              UPDATE item_routes SET test_station_id = ${nextStationId}
              WHERE item_id = ${itemIdBig} AND route_number = ${updatedRouteNumber} AND finished_at IS NULL
            `;
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

      // Update test_stations status to 2 (Available/Waiting)
      await tx.test_stations.update({
        where: { test_station_id: StationID },
        data: { status: 2 },
      });

      // 4. Calculate research station recommendation if sendToResearch
      let recommendedResearchStation: any = null;
      if (sendToResearch === true) {
        try {
          const researchStationRows = await tx.$queryRaw<any[]>`
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
          }
        } catch (researchError) {
          console.error("Error calculating research station:", researchError);
        }
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
      };
    });

    // 5. Calculate next recommended station (after transaction committed)
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
      const { updatedStatus, updatedRouteStep, updatedItemTypeId, routeNumber, isResearchStatus } = txResult;

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

          const nextStationTypeResult = await prisma.$queryRaw<any[]>`
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
            // No next station type found (last step) - mark item as finished
            try {
              await prisma.$transaction(async (tx) => {
                const itemDetailsRows = await tx.$queryRaw<any[]>`
                  SELECT item_type_id, created_at, processing_start_time, queue_start_time, current_route_step, test_station_id
                  FROM item_routes WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
                `;

                if (itemDetailsRows.length > 0) {
                  const itemDetails = itemDetailsRows[0];
                  const finishTime = getCurrentUtcIso();
                  const finishTimeDate = new Date(finishTime);

                  // INSERT into finished_item
                  await tx.$executeRaw`
                    INSERT INTO finished_item (
                      item_id, item_type_id, current_status, current_route_step, test_station_id,
                      created_at, finished_at, is_finished, processing_start_time, queue_start_time
                    )
                    VALUES (
                      ${itemIdBig}, ${itemDetails.item_type_id}, 2,
                      ${itemDetails.current_route_step}, ${itemDetails.test_station_id || StationID},
                      ${itemDetails.created_at ? new Date(itemDetails.created_at) : null}::timestamp,
                      ${finishTimeDate}::timestamp, true,
                      ${itemDetails.processing_start_time ? new Date(itemDetails.processing_start_time) : null}::timestamp,
                      ${itemDetails.queue_start_time ? new Date(itemDetails.queue_start_time) : null}::timestamp
                    )
                    ON CONFLICT (item_id) DO UPDATE SET
                      finished_at = EXCLUDED.finished_at,
                      current_status = EXCLUDED.current_status,
                      is_finished = EXCLUDED.is_finished
                  `;

                  // UPDATE item_routes to mark as finished
                  await tx.$executeRaw`
                    UPDATE item_routes
                    SET current_status = 3, finished_at = ${finishTimeDate}::timestamp, is_finished = true
                    WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
                  `;
                }
              });
            } catch (finishError) {
              console.error("Error marking item as finished:", finishError);
            }
            nextStationRecommendation = { isLastStation: true };
          } else {
            const nextStationTypeId = nextStationTypeResult[0].next_station_type_id;

            // Find all stations of this type with load calculation
            const stationsWithLoadResult = await prisma.$queryRaw<any[]>`
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
              // No stations of this type found - mark item as finished
              try {
                await prisma.$transaction(async (tx) => {
                  const itemDetailsRows = await tx.$queryRaw<any[]>`
                    SELECT item_type_id, created_at, processing_start_time, queue_start_time, current_route_step, test_station_id
                    FROM item_routes WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
                  `;

                  if (itemDetailsRows.length > 0) {
                    const finishTimeDate = new Date(getCurrentUtcIso());

                    await tx.$executeRaw`
                      UPDATE item_routes
                      SET current_status = 3, finished_at = ${finishTimeDate}::timestamp
                      WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber}
                    `;
                  }
                });
              } catch (finishError) {
                console.error("Error marking item as finished:", finishError);
              }
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
                    try {
                      await prisma.$executeRaw`
                        UPDATE item_routes
                        SET test_station_id = ${selectedStation.test_station_id}
                        WHERE item_id = ${itemIdBig} AND route_number = ${routeNumber} AND finished_at IS NULL
                      `;
                    } catch (updateError) {
                      console.error("Error updating item_routes.test_station_id:", updateError);
                    }

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

      // Try to mark item as finished if we have the necessary data
      if (ItemID && txResult.routeNumber && txResult.updatedItemTypeId) {
        try {
          await prisma.$transaction(async (tx) => {
            const finishTimeDate = new Date(getCurrentUtcIso());

            await tx.$executeRaw`
              UPDATE item_routes
              SET current_status = 3, finished_at = ${finishTimeDate}::timestamp
              WHERE item_id = ${itemIdBig} AND route_number = ${txResult.routeNumber}
            `;
          });
        } catch (finishError) {
          console.error("Error marking item as finished after calculation error:", finishError);
        }
      }

      nextStationRecommendation = { isLastStation: true };
    }

    const responseData: any = {
      ok: true,
      success: true,
      researchId: txResult.researchId,
      logId: txResult.historyLogId,
      isLastStep,
      ...nextStationRecommendation,
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
