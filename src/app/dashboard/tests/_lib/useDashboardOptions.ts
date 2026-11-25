"use client";
import { useCustomers, useItemTypeRows, useShipments, useStationTypes, useStations } from "@/app/components/lookups";

export type DashboardOptions = ReturnType<typeof useDashboardOptions>;

const FRESH = { fresh: true };

/** The rail's picker lists: the app's lookup lists, read again whenever the dashboard mounts. A list
 *  whose request fails stays empty; the others still load. */
export function useDashboardOptions() {
  return {
    customers: useCustomers(undefined, FRESH).data ?? [],
    stations: useStations(FRESH).data ?? [],
    stationTypes: useStationTypes(FRESH).data ?? [],
    itemTypes: useItemTypeRows(FRESH).data ?? [],
    shipments: useShipments(FRESH).data ?? [],
  };
}
