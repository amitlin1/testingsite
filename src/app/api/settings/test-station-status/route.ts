import { listJson, listTestStationStatuses } from "@/app/lib/lookups";
import { STATION_STATUS_WRITES } from "./writes";

export const runtime = "nodejs";

export async function GET() {
  return listJson(listTestStationStatuses, "Error fetching test station statuses:", { emptyOnError: true });
}

export const { POST } = STATION_STATUS_WRITES;
