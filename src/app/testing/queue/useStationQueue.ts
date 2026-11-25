import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TestStation } from "@/app/lib/testing/contract";
import { useStations } from "@/app/components/lookups";
import { loadBlockedPackages, loadCompletedSince, loadQueue, loadStationTypes } from "../api";

/** The station queue could not be loaded (network / server). */
const QUEUE_LOAD_FAILED = "לא ניתן לטעון את התור של העמדה. בדוק את החיבור ונסה שוב.";

/**
 * The station on screen and its queue: the station types and the flat station list (the dock's
 * all-stations search), the queue (polled, refreshed on focus and after every action), "completed
 * today", and at a closing station the boxes still waiting for their items. A refresh of the same
 * station keeps its list on screen (ST-7); a newly picked station shows skeletons until its own
 * queue answers.
 */
export function useStationQueue(stationId: number | null) {
  const queryClient = useQueryClient();
  const stationTypesQ = useQuery({ queryKey: ["testing", "station-types"], queryFn: loadStationTypes, staleTime: 5 * 60_000 });
  const stationTypes = React.useMemo(() => stationTypesQ.data ?? [], [stationTypesQ.data]);
  const allStationsQ = useStations();
  const allStations = React.useMemo(() => allStationsQ.data ?? [], [allStationsQ.data]);

  // The station is the URL's; its type follows from the station list.
  const stationLite = stationId != null ? allStations.find((s) => s.id === stationId) ?? null : null;
  const station = React.useMemo<TestStation | null>(
    () => (stationLite ? { test_station_id: stationLite.id, test_station_desc: stationLite.name, test_station_type_id: stationLite.typeId } : null),
    [stationLite],
  );
  const stationType = station ? stationTypes.find((t) => t.id === station.test_station_type_id) ?? null : null;
  // Package model (docs/packages/PLAN.md §4): opening / closing station types queue boxes, not
  // items (design/Testing Screen Packages.dc.html).
  const packageLevel = !!stationType?.packageLevel;

  const itemsQ = useQuery({
    queryKey: ["testing", "items", stationId],
    enabled: stationId != null,
    queryFn: () => loadQueue(stationId!),
    refetchInterval: 20_000,
  });
  const items = React.useMemo(() => itemsQ.data ?? [], [itemsQ.data]);

  // item_route_history rows for this station since local midnight.
  const completedQ = useQuery({
    queryKey: ["testing", "completed-today", stationId],
    enabled: stationId != null,
    refetchInterval: 60_000,
    queryFn: () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return loadCompletedSince(stationId!, startOfDay);
    },
  });

  const blockedQ = useQuery({
    queryKey: ["testing", "blocked", stationId],
    enabled: stationId != null && packageLevel,
    queryFn: () => loadBlockedPackages(stationId!),
  });

  const refresh = React.useCallback(() => {
    if (stationId == null) return;
    for (const k of ["items", "completed-today", "blocked"]) queryClient.invalidateQueries({ queryKey: ["testing", k, stationId] });
  }, [queryClient, stationId]);

  return {
    stationTypes,
    allStations,
    station,
    stationType,
    packageLevel,
    items,
    /** A refresh is running (over a list already on screen, or the first load). */
    loading: itemsQ.isFetching,
    // A failed queue load is an error with "נסה שוב", never an empty queue (ST-1).
    error: itemsQ.isError && !itemsQ.data ? QUEUE_LOAD_FAILED : null,
    // The queue on screen belongs to another (or no) station yet: skeletons and "—" until the
    // selected station's queue answers. A station id the station list does not know (yet) counts
    // as loading, too.
    stale: stationId != null && (itemsQ.isPending || (station == null && allStationsQ.isPending)),
    completedToday: completedQ.data ?? null,
    blockedPackages: packageLevel ? blockedQ.data ?? [] : [],
    refresh,
  };
}
