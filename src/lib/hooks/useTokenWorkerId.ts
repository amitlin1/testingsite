"use client";
import { useSession } from "next-auth/react";

/**
 * The logged-in user's worker id, derived from their Keycloak `employeeNumber`
 * (מספר עובד). This replaces manual "who's working" self-selection: everywhere a
 * user used to pick THEMSELVES, use this instead.
 *
 * Returns null when the user has no (valid) employeeNumber — callers must stay
 * tolerant and fall back to a manual picker so a user without the attribute set
 * can still work. See the [[worker-auto-select-from-token]] task.
 */
export function useTokenWorkerId(): number | null {
  const { data: session } = useSession();
  const raw = session?.user?.employeeNumber;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
