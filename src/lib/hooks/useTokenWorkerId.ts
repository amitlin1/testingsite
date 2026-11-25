"use client";
import { useSession } from "next-auth/react";
import { identityOf } from "@/lib/auth/identity";

/**
 * The logged-in user's worker id, derived from their Keycloak `employeeNumber`
 * (מספר עובד). This replaces manual "who's working" self-selection: everywhere a
 * user used to pick THEMSELVES, use this instead.
 *
 * Returns null when the user has no (valid) employeeNumber — callers must stay
 * tolerant and fall back to a manual picker so a user without the attribute set
 * can still work.
 */
export function useTokenWorkerId(): number | null {
  const { data: session } = useSession();
  return identityOf(session).workerId;
}
