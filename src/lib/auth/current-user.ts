// Current-user resolver.
//
// Identity (name, roles, username) comes ENTIRELY from the Keycloak token: the
// auth flow (auth.ts, middleware) never touches a DB.
//
// getCurrentUser is wrapped in React cache() so it runs at most once per request
// even though several callers invoke it.

import { cache } from "react";
import { currentSession } from "@/lib/auth/current-session";
import { identityOf } from "./identity";
import { isLiveSession } from "./session";

export interface CurrentUser {
  /** Keycloak preferred_username (e.g. the login name). */
  preferredUsername: string;
  /** Display name — Keycloak display_name/name, else the username (identityOf). */
  name: string;
  /** Merged realm + client roles (empty array when none). */
  roles: string[];
  /** מספר עובד — Keycloak custom attribute (null if unset for this user). */
  employeeNumber: string | null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await currentSession().catch(() => null);
  // No session, or one whose silent refresh failed terminally (stale) — treat
  // as anonymous so a page reached outside the middleware matcher can't act on
  // a dead identity. (This is the null that requireUser() redirects on.)
  if (!isLiveSession(session)) return null;

  const { username, displayName, employeeNumber } = identityOf(session);
  return {
    preferredUsername: username,
    name: displayName,
    roles: session.roles ?? [],
    employeeNumber,
  };
});
