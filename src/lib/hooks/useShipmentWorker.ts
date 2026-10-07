"use client";
import { useSession } from "next-auth/react";
import { isAdmin } from "@/lib/auth/roles";
import { useTokenWorkerId } from "@/lib/hooks/useTokenWorkerId";

export type DirectoryWorker = { worker_id: number; worker_name: string; roles: string[] };

/**
 * Who fills the shipment worker fields — "עובד מקבל" (new / edit shipment) and
 * "עובד מוציא" (return shipment):
 *
 *   - everyone starts from THEMSELVES, identified by the employeeNumber on
 *     their login;
 *   - only a manager may change it, picking any storekeeper (or themselves);
 *   - anyone else is locked to themselves, and without an employeeNumber can't
 *     be identified at all — `blocked`, and the form refuses to save.
 *
 * The servers apply the same rule (POST/PUT /api/shipments,
 * POST /api/shipment-history), so the lock can't be sidestepped.
 */
export function useShipmentWorker(workers: DirectoryWorker[]) {
  const { data: session } = useSession();
  const selfId = useTokenWorkerId();
  const isManager = isAdmin(session?.roles ?? []);
  const selfName =
    (selfId != null ? workers.find((w) => w.worker_id === selfId)?.worker_name : undefined) ??
    session?.user?.displayName ?? session?.user?.name ?? null;
  const storekeepers = workers.filter((w) => w.roles.includes("storekeeper"));
  // A manager who isn't a storekeeper still starts from their own name, so
  // they must be in the list for it to show.
  const self = selfId != null ? workers.find((w) => w.worker_id === selfId) : undefined;
  const options = self && !storekeepers.some((w) => w.worker_id === self.worker_id) ? [self, ...storekeepers] : storekeepers;
  return {
    selfId,
    selfName,
    isManager,
    /** Field locked to the logged-in worker. */
    locked: !isManager,
    /** Not a manager and no employeeNumber: nobody to attribute the shipment to. */
    blocked: !isManager && selfId == null,
    options,
  };
}
