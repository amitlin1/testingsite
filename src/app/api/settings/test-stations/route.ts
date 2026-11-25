import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { getStationLiveCounters } from "@/app/lib/metrics/read/station-counters";
import { insertLookupRow, listJson, listStations } from "@/app/lib/lookups";
import { stationName } from "./name";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const typeId = new URL(req.url).searchParams.get("typeId");
  return listJson(async () => {
    const rows = await listStations(typeId ? parseInt(typeId, 10) : undefined);
    // Live queue/test counts from the metrics ledger (Q3), so the Settings page shows the SAME
    // numbers as the dashboard's station board. items_in_queue is the station TYPE's queue and
    // repeats across the stations of a type — see station-counters.ts.
    const live = new Map((await getStationLiveCounters()).map((c) => [c.stationId, c]));
    return rows.map((r) => ({
      test_station_id: r.test_station_id,
      test_station_type_id: r.test_station_type_id,
      test_station_desc: r.test_station_desc,
      status: r.status,
      is_research: r.is_research,
      test_type_desc: r.test_type_desc,
      items_in_queue: live.get(r.test_station_id)?.sharedTypeQueue ?? 0,
      items_in_test: live.get(r.test_station_id)?.itemsInActiveWork ?? 0,
    }));
  }, "Error fetching test stations:", { emptyOnError: true });
}

export async function POST(req: Request) {
  try {
    const { test_station_type_id, test_station_desc, status, is_research } = await readJsonObject(req);
    if (!test_station_type_id || !test_station_desc) throw new HttpError(400, "Type and Description are required");
    const desc = (test_station_desc as string).trim();
    const data = {
      test_station_type_id: test_station_type_id as number,
      test_station_desc: desc,
      status: (status as number) || 0,
      is_research: (is_research as boolean) || false,
    };
    const created = await insertLookupRow(() => prisma.test_stations.create({ data }), {
      duplicate: stationName(desc),
      sequence: {
        table: "test_stations",
        idColumn: "test_station_id",
        name: "test_stations_test_station_id_seq",
        retryFailed: "שגיאה ביצירת עמדה. נא לנסות שוב.",
      },
    });
    return NextResponse.json({
      test_station_id: created.test_station_id,
      test_station_type_id: created.test_station_type_id,
      test_station_desc: created.test_station_desc.trim(),
      status: created.status,
      is_research: created.is_research,
    });
  } catch (error) {
    return errorResponse(error, "Failed to create test station");
  }
}
