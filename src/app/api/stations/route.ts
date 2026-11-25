import { listJson, listStations } from "@/app/lib/lookups";

export const runtime = "nodejs";

/** The station's name only — the internal id meant nothing to the workers (the pickers show the
 *  station type under the name). */
export async function GET() {
  return listJson(
    async () => (await listStations()).map((s) => ({ id: s.test_station_id, name: s.test_station_desc, typeId: s.test_station_type_id })),
    "Error loading stations:",
    { emptyOnError: true },
  );
}
