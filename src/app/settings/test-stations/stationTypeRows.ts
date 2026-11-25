"use client";
import { getArray } from "@/lib/api/client";
import { useListQuery } from "@/lib/hooks/useListQuery";
import type { StationTypeRow } from "@/app/lib/lookups/contract";

export const STATION_TYPES_URL = "/api/settings/test-stations-type";

/** The station types of the settings screen: one cached list, read by the master table and by the
 *  detail's header. */
export function useStationTypeRows() {
  return useListQuery<StationTypeRow>([STATION_TYPES_URL], () => getArray<StationTypeRow>(STATION_TYPES_URL));
}
