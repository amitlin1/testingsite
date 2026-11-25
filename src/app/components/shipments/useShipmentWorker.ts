"use client";
import { useSession } from "next-auth/react";
import { identityOf } from "@/lib/auth/identity";
import { useTokenWorkerId } from "@/lib/hooks/useTokenWorkerId";
import type { DirectoryWorker } from "@/lib/users/rules";
import { picksShipmentWorker } from "@/app/lib/shipments/worker";

/** The shipment worker field of a form, by the shipments rule (lib/shipments/worker.ts). */
export function useShipmentWorker(workers: DirectoryWorker[]) {
  const { data: session } = useSession();
  const selfId = useTokenWorkerId();
  const isManager = picksShipmentWorker(session);
  const selfName =
    (selfId != null ? workers.find((w) => w.worker_id === selfId)?.worker_name : undefined) ??
    (identityOf(session).displayName || null);
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
