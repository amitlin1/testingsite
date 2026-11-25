"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PackageTimelineEntry, PackageView } from "@/app/lib/packages/contract";
import { getJson, sendJson } from "@/lib/api/client";

/**
 * The packages data, through React Query. Every read shares the "packages"
 * key prefix — the board's lists and the package page alike — so a change
 * made anywhere (intake, an edit, a delete) refreshes whatever is on screen
 * with one invalidate. The lookups (customers, types, shipments) are
 * components/lookups.ts.
 */

const PACKAGES_KEY = ["packages"] as const;

/** The active boxes, or one shipment's boxes (sent ones included). */
export function usePackages(shipment: string) {
  return useQuery({
    queryKey: [...PACKAGES_KEY, "list", { shipment }],
    queryFn: () => getJson<PackageView[]>(shipment ? `/api/packages?shipment=${encodeURIComponent(shipment)}` : "/api/packages"),
    // Stations move items all day; a quiet poll keeps the steps current.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useSentLookup(code: string | null) {
  return useQuery({
    queryKey: [...PACKAGES_KEY, "sent-lookup", code],
    enabled: !!code,
    queryFn: async () => {
      const rows = await getJson<PackageView[]>(`/api/packages?includeSent=1&q=${encodeURIComponent(code!)}`);
      return rows.filter((p) => p.shipment_is_sent);
    },
  });
}

export type PackageTimeline = (PackageTimelineEntry & { worker_name: string | null })[];

/** One box with its timeline (the package page). Read once per visit and
 *  after a change — no retry, no refetch on focus: a failure shows at once
 *  with its own retry. */
export function usePackagePage(id: string | undefined) {
  return useQuery({
    queryKey: [...PACKAGES_KEY, "page", id],
    enabled: !!id,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data = await getJson<{ package?: PackageView | null; timeline?: unknown }>(`/api/packages/${id}`);
      return { pkg: data.package ?? null, timeline: (Array.isArray(data.timeline) ? data.timeline : []) as PackageTimeline };
    },
  });
}

export function useInvalidatePackages() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PACKAGES_KEY });
}

/* The box editors' rules and requests — the board's in-row editor, the package
 * page's dialog and the opening's contents step share them. */

/** The item types a box can hold: every type but the package types. */
export const memberTypesOf = <T extends { is_package?: boolean }>(types: readonly T[]): T[] => types.filter((t) => !t.is_package);

/** An item added to a box needs its type and a serial. */
export const canAddBoxItem = (itemType: string, serial: string): boolean => itemType !== "" && serial.trim() !== "";

/** The open fields of a box (PATCH /api/packages/[id]); type, customer and shipment are locked. */
type BoxFields = { makat: string; model: string; manufacturer: string };

export function patchBox(packageId: string, fields: BoxFields) {
  return sendJson(`/api/packages/${packageId}`, "PATCH", fields);
}

/** One more item into a box still at its opening (POST /api/packages/[id]/items). */
type NewBoxItem = { itemType: number; serialNumber: string; makat: string; model: string; manufacturer: string };

export function addBoxItem(packageId: string, item: NewBoxItem) {
  return sendJson(`/api/packages/${packageId}/items`, "POST", item);
}

/** Marks every packages read stale without refetching what is on screen now
 *  (a screen about to leave: the next one mounted reads fresh). */
export function useMarkPackagesStale() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PACKAGES_KEY, refetchType: "none" });
}
