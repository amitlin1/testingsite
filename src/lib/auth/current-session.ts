import type { Session } from "next-auth";
import { auth } from "@/auth";
import { isDevAuthBypass } from "@/lib/auth/session";

/** Dev mode: every request is signed in as one local user (see isDevAuthBypass). */
export const DEV_AUTH_BYPASS = isDevAuthBypass(process.env);

/** The local user: DEV_USER (default "dev"), DEV_ROLES (comma-separated, default "manager"), DEV_EMPLOYEE_NUMBER. */
export function devSession(): Session {
  const username = process.env.DEV_USER || "dev";
  return {
    user: { name: username, preferredUsername: username, displayName: username, employeeNumber: process.env.DEV_EMPLOYEE_NUMBER || null },
    roles: (process.env.DEV_ROLES || "manager").split(",").map((r) => r.trim()).filter(Boolean),
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

/** The request's session (the local user in dev mode). */
export const currentSession = (): Promise<Session | null> => (DEV_AUTH_BYPASS ? Promise.resolve(devSession()) : auth());
