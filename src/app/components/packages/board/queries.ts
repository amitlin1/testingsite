"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";

/**
 * Data of the packages screen, through React Query. Every list shares the
 * "packages" key prefix, so a mutation anywhere (intake, an edit, a delete)
 * refreshes whatever list is on screen with one invalidate.
 */

export type Option = { value: string; label: string };
export type ShipmentLite = { id: number; shipment_code: string; customer_name?: string | null; source_id: number | null; is_sent: boolean | null; shipment_sent_date: string | null };
export type ItemTypeLite = { item_type_id: number; item_type_desc: string; is_package?: boolean };

export class HttpError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (body as { error?: string })?.error || "הטעינה נכשלה", body as Record<string, unknown>);
  return body as T;
}

/** POST / PUT / PATCH / DELETE with a JSON body; throws HttpError with the server's message. */
export async function sendJson<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string })?.error || "הפעולה נכשלה", data as Record<string, unknown>);
  return data as T;
}

export const PACKAGES_KEY = ["packages"] as const;

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

/** A scanned code that matched nothing active: did that box already leave? */
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

const LOOKUP = { staleTime: 5 * 60_000 };

export function useCustomers() {
  return useQuery({
    queryKey: ["customers"],
    ...LOOKUP,
    queryFn: async () => {
      const d = await getJson<{ id: number; name: string; customer_code: string | null }[]>("/api/customers");
      return (Array.isArray(d) ? d : []).map((c): Option => ({ value: String(c.id), label: c.customer_code ? `${c.name} (${c.customer_code})` : c.name }));
    },
  });
}

export function useShipments() {
  return useQuery({
    queryKey: ["shipments"],
    ...LOOKUP,
    queryFn: async () => {
      const d = await getJson<ShipmentLite[]>("/api/shipments");
      return Array.isArray(d) ? d : [];
    },
  });
}

export function usePackageTypes() {
  return useQuery({
    queryKey: ["package-types"],
    ...LOOKUP,
    queryFn: async () => {
      const d = await getJson<{ item_type_id: number; item_type_desc: string }[]>("/api/settings/package-types");
      return (Array.isArray(d) ? d : []).map((t): Option => ({ value: String(t.item_type_id), label: t.item_type_desc }));
    },
  });
}

export function useItemTypes() {
  return useQuery({
    queryKey: ["item-types"],
    ...LOOKUP,
    queryFn: async () => {
      const d = await getJson<ItemTypeLite[]>("/api/itemTypes");
      return Array.isArray(d) ? d : [];
    },
  });
}

export function useInvalidatePackages() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PACKAGES_KEY });
}
