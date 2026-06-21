import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeToUtcIso } from "@/app/lib/datetime";
import { TimeSeriesPoint } from "@/types/dashboard";
import { buildDashboardFilters } from "@/app/lib/dashboard-filters";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const bucketSize = searchParams.get("bucketSize") || "auto";
    const status = searchParams.get("status");

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate and endDate are required" },
        { status: 400 }
      );
    }

    // Build filters - Start index 3 because $1 and $2 are dates
    const filters = buildDashboardFilters({
      searchParams,
      startIndex: 3,
      itemRef: "irh.item_id",
      stationRef: "irh.test_station_id",
      workerRef: "irh.worker_id",
    });

    // Validate dates
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    if (startDateObj > endDateObj) {
      return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
    }

    let actualBucketSize = bucketSize;
    if (bucketSize === "auto") {
      const diffHours = (endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60);
      actualBucketSize = diffHours <= 48 ? "hour" : "day";
    }

    if (actualBucketSize !== "hour" && actualBucketSize !== "day") {
      return NextResponse.json(
        { error: "bucketSize must be 'hour', 'day', or 'auto'" },
        { status: 400 }
      );
    }

    const truncFunctionQueue = actualBucketSize === "hour"
      ? "date_trunc('hour', irh.processing_start_time)"
      : "date_trunc('day', irh.processing_start_time)";
    const truncFunctionProcessing = actualBucketSize === "hour"
      ? "date_trunc('hour', irh.processing_end_time)"
      : "date_trunc('day', irh.processing_end_time)";

    const showQueue = !status || status === "all" || status === "queue" || status === "finished";
    const showProcessing = !status || status === "all" || status === "processing" || status === "finished";

    const queryParams = [startDate, endDate, ...filters.params];

    const queueTimeQuery = `
      SELECT
        ${truncFunctionQueue} AS bucket,
        COALESCE(
          AVG(EXTRACT(EPOCH FROM (irh.processing_start_time - irh.queue_start_time)) / 60.0),
          0
        ) AS avg_queue_minutes
      FROM item_route_history irh
      WHERE irh.processing_start_time IS NOT NULL
        AND irh.queue_start_time IS NOT NULL
        AND irh.processing_start_time >= $1::timestamp
        AND irh.processing_start_time <= $2::timestamp
        ${filters.conditions}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const processingTimeQuery = `
      SELECT
        ${truncFunctionProcessing} AS bucket,
        COALESCE(
          AVG(EXTRACT(EPOCH FROM (irh.processing_end_time - irh.processing_start_time)) / 60.0),
          0
        ) AS avg_processing_minutes
      FROM item_route_history irh
      WHERE irh.processing_end_time IS NOT NULL
        AND irh.processing_start_time IS NOT NULL
        AND irh.processing_end_time >= $1::timestamp
        AND irh.processing_end_time <= $2::timestamp
        ${filters.conditions}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const [queueTimeRows, processingTimeRows] = await Promise.all([
      showQueue ? prisma.$queryRawUnsafe<any[]>(queueTimeQuery, ...queryParams) : Promise.resolve([]),
      showProcessing ? prisma.$queryRawUnsafe<any[]>(processingTimeQuery, ...queryParams) : Promise.resolve([]),
    ]);

    // Create a complete timeline map
    const completeTimelineMap = new Map<string, { queue: number | null, processing: number | null }>();

    const current = new Date(startDateObj);
    if (actualBucketSize === "hour") {
      current.setUTCMinutes(0, 0, 0);
    } else {
      current.setUTCHours(0, 0, 0, 0);
    }

    const end = new Date(endDateObj);

    while (current <= end) {
      completeTimelineMap.set(current.toISOString(), { queue: 0, processing: 0 });
      if (actualBucketSize === "hour") {
        current.setUTCHours(current.getUTCHours() + 1);
      } else {
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    if (showQueue) {
      queueTimeRows.forEach((row: any) => {
        const timestamp = normalizeToUtcIso(row.bucket);
        if (timestamp && completeTimelineMap.has(timestamp)) {
          const currentVal = completeTimelineMap.get(timestamp)!;
          completeTimelineMap.set(timestamp, { ...currentVal, queue: row.avg_queue_minutes });
        }
      });
    }

    if (showProcessing) {
      processingTimeRows.forEach((row: any) => {
        const timestamp = normalizeToUtcIso(row.bucket);
        if (timestamp && completeTimelineMap.has(timestamp)) {
          const currentVal = completeTimelineMap.get(timestamp)!;
          completeTimelineMap.set(timestamp, { ...currentVal, processing: row.avg_processing_minutes });
        }
      });
    }

    const sortedTimestamps = Array.from(completeTimelineMap.keys()).sort();

    const timeSeries: TimeSeriesPoint[] = sortedTimestamps.map((timestamp) => ({
      timestamp,
      queueTimeMinutes: completeTimelineMap.get(timestamp)?.queue ?? 0,
      processingTimeMinutes: completeTimelineMap.get(timestamp)?.processing ?? 0,
    }));

    return NextResponse.json(timeSeries);
  } catch (error) {
    console.error("Error fetching time series data:", error);
    return NextResponse.json([]);
  }
}
