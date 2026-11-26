"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getArray } from "@/lib/api/client";
import type { Customers } from "@/app/lib/shipments/contract";
import type { DirectoryWorker } from "@/lib/users/rules";
import type { ItemTypeLite, ItemTypeRow, SourceRow, StationRow, StationTypeOption } from "@/app/lib/lookups/contract";

/**
 * The app's lookup lists (customers, shipments, types, sources, stations, workers), through React
 * Query: one cached copy per list, shared by every screen that picks from it (the packages board,
 * the shipment forms, the dashboard rail). The cache holds the endpoint's rows as they come; a
 * screen narrows them with `select`. A settings write calls useInvalidateLookup for the table it
 * changed, so the pickers in the same tab read it again.
 */

export type Option = { value: string; label: string };
export type ShipmentLite = { id: number; shipment_code: string; customer_code?: string | null; customer_name?: string | null; source_id: number | null; is_sent: boolean | null; shipment_sent_date: string | null };

/** The pickers' query keys. A key is the prefix of every narrower list of the same table. */
export const LOOKUP_KEY = {
  customers: ["customers"],
  shipments: ["shipments"],
  packageTypes: ["package-types"],
  itemTypes: ["item-types"],
  itemTypeRows: ["item-types", "rows"],
  sources: ["sources"],
  stations: ["stations"],
  stationTypes: ["station-types"],
  workers: ["workers-directory"],
} as const;

/** The tables a settings screen writes. */
export type LookupTable = "customers" | "sources" | "itemTypes" | "packageTypes" | "stations" | "stationTypes";

/** The pickers a write to each table makes stale (a package type is an item type). */
const STALE_AFTER_WRITE: Record<LookupTable, readonly (readonly string[])[]> = {
  customers: [LOOKUP_KEY.customers],
  sources: [LOOKUP_KEY.sources],
  itemTypes: [LOOKUP_KEY.itemTypes, LOOKUP_KEY.packageTypes],
  packageTypes: [LOOKUP_KEY.packageTypes, LOOKUP_KEY.itemTypes],
  stations: [LOOKUP_KEY.stations],
  stationTypes: [LOOKUP_KEY.stationTypes, LOOKUP_KEY.stations],
};

/** After a settings write to `table`: every picker of it reads again when next shown. */
export function useInvalidateLookup(): (table: LookupTable) => void {
  const queryClient = useQueryClient();
  return (table) => {
    for (const queryKey of STALE_AFTER_WRITE[table]) void queryClient.invalidateQueries({ queryKey });
  };
}

const LOOKUP = { staleTime: 5 * 60_000 };

/** `fresh`: read again whenever a screen mounts (the dashboard rail), instead of trusting a copy up
 *  to five minutes old. */
const freshness = (fresh: boolean) => (fresh ? { staleTime: 0, refetchOnWindowFocus: false } : LOOKUP);

/** A customer as a picker shows it: "name (code)". */
/** How a customer is shown anywhere in the system: by its CODE only. The name is
 *  seen on the customers settings page alone — workers know a customer by code
 *  (Amit, 2026-11-26). */
export const customerLabel = (c: { customer_code: string | null }) => c.customer_code?.trim() || "—";

export function useCustomers<T = Customers[]>(select?: (rows: Customers[]) => T, { fresh = false } = {}) {
  return useQuery({ queryKey: LOOKUP_KEY.customers, ...freshness(fresh), queryFn: () => getArray<Customers>("/api/customers"), select });
}

export const customerOptions = (list: Customers[]): Option[] => list.map((c) => ({ value: String(c.id), label: customerLabel(c) }));

/** /api/shipments read as a lookup (id, code, customer, sent). */
export function useShipments<T = ShipmentLite[]>({ fresh = false, select }: { fresh?: boolean; select?: (rows: ShipmentLite[]) => T } = {}) {
  return useQuery({ queryKey: LOOKUP_KEY.shipments, ...freshness(fresh), queryFn: () => getArray<ShipmentLite>("/api/shipments"), select });
}

/** The package types, as /api/settings/package-types lists them. */
export function usePackageTypes() {
  return useQuery({
    queryKey: LOOKUP_KEY.packageTypes,
    ...LOOKUP,
    queryFn: async () => (await getArray<{ item_type_id: number; item_type_desc: string }>("/api/settings/package-types"))
      .map((t): Option => ({ value: String(t.item_type_id), label: t.item_type_desc })),
  });
}

/** Every item type (/api/itemTypes). */
export function useItemTypes() {
  return useQuery({ queryKey: LOOKUP_KEY.itemTypes, ...LOOKUP, queryFn: () => getArray<ItemTypeLite>("/api/itemTypes") });
}

/** Every item type as /api/item-types lists it ({ id, name, is_package }). */
export function useItemTypeRows({ fresh = false } = {}) {
  return useQuery({ queryKey: LOOKUP_KEY.itemTypeRows, ...freshness(fresh), queryFn: () => getArray<ItemTypeRow>("/api/item-types") });
}

export function useSources() {
  return useQuery({ queryKey: LOOKUP_KEY.sources, ...LOOKUP, queryFn: () => getArray<SourceRow>("/api/sources") });
}

/** Every station by name (/api/stations). */
export function useStations({ fresh = false } = {}) {
  return useQuery({ queryKey: LOOKUP_KEY.stations, ...freshness(fresh), queryFn: () => getArray<StationRow>("/api/stations") });
}

/** Every station type by id (/api/testing/stations/types). */
export function useStationTypes({ fresh = false } = {}) {
  return useQuery({
    queryKey: LOOKUP_KEY.stationTypes,
    ...freshness(fresh),
    queryFn: () => getArray<StationTypeOption>("/api/testing/stations/types"),
  });
}

export function useWorkersDirectory() {
  return useQuery({ queryKey: LOOKUP_KEY.workers, ...LOOKUP, queryFn: () => getArray<DirectoryWorker>("/api/workers-directory") });
}
