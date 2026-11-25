"use client";
import { useSession } from "next-auth/react";
import { ACCESS, hasAnyRole } from "@/lib/auth/roles";
import { useTokenWorkerId } from "@/lib/hooks/useTokenWorkerId";

/**
 * The acting worker's lock, as the testing screen and the item files decide it: a login that
 * carries a worker id (Keycloak employeeNumber) acts as that worker, locked — unless it may act for
 * others (ACCESS.actAsOtherWorker), when it may pick someone else. A login without one picks by hand.
 */
export function useWorkerLock(): { tokenWorkerId: number | null; locked: boolean } {
  const tokenWorkerId = useTokenWorkerId();
  const { data: session } = useSession();
  return { tokenWorkerId, locked: tokenWorkerId != null && !hasAnyRole(session?.roles ?? [], ACCESS.actAsOtherWorker) };
}
