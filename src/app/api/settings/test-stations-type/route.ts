import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { readJsonObject } from "@/lib/http/request";
import { insertLookupRow, listJson, listStationTypes, parseStaleAfterMinutes, requiredText } from "@/app/lib/lookups";
import { DEFAULT_STALE_AFTER_MINUTES } from "@/lib/item-status";
import { stationTypeName } from "./name";

export const runtime = "nodejs";

export async function GET() {
  return listJson(async () => (await listStationTypes()).map((t) => ({
    test_station_type_id: t.test_station_type_id,
    test_type_desc: t.test_type_desc,
    package_level: t.package_level,
    stale_after_minutes: t.stale_after_minutes,
    station_count: t.station_count,
  })), "Error fetching test station types:", { emptyOnError: true });
}

export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    const packageLevel = Boolean(body.package_level);
    const desc = requiredText(body.test_type_desc);
    if (!desc) throw new HttpError(400, "Description is required");
    const staleAfterMinutes = parseStaleAfterMinutes(body.stale_after_minutes) ?? DEFAULT_STALE_AFTER_MINUTES;
    const data = { test_type_desc: desc, package_level: packageLevel, stale_after_minutes: staleAfterMinutes };
    const created = await insertLookupRow(() => prisma.test_stations_type.create({ data }), {
      duplicate: stationTypeName(desc),
      sequence: {
        table: "test_stations_type",
        idColumn: "test_station_type_id",
        name: "test_stations_type_test_station_type_id_seq",
        retryFailed: "שגיאה ביצירת סוג עמדה. נא לנסות שוב.",
      },
    });
    return NextResponse.json({
      test_station_type_id: created.test_station_type_id,
      test_type_desc: created.test_type_desc.trim(),
      package_level: created.package_level,
      stale_after_minutes: created.stale_after_minutes,
    });
  } catch (error) {
    return errorResponse(error, "Failed to create test station type");
  }
}
