// Current-user resolver. TEMPLATE — add app-specific identity resolution.
//
// ARCHITECTURE: identity (name, roles, username) comes ENTIRELY from the
// Keycloak token. The auth flow (auth.ts, middleware) never touches a DB, which
// keeps it portable. If this app maps the Keycloak user to a local row, do that
// lookup at the marked point — and keep it TOLERANT (no row ⇒ still a valid,
// authenticated user, features degrade gracefully).
//
// getCurrentUser is wrapped in React cache() so it runs at most once per request
// even though several callers invoke it.

import { cache } from "react";
import { auth } from "@/../auth";

export interface CurrentUser {
  /** Keycloak preferred_username (e.g. the login name). */
  preferredUsername: string;
  /** Display name — Keycloak display_name/name, else the username. */
  name: string;
  /** Merged realm + client roles (empty array when none). */
  roles: string[];
  /** מספר עובד — Keycloak custom attribute (null if unset for this user). */
  employeeNumber: string | null;
  // >>> APP-SPECIFIC: add fields the app needs (e.g. a canonical local id
  // resolved from preferredUsername). Keep them nullable so a user with no
  // matching local row is still valid.
  // id?: number | null;
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth().catch(() => null);
  // A session whose silent refresh failed terminally is stale — treat as
  // anonymous so a page reached outside the middleware matcher can't act on a
  // dead identity. (This is the null that requireUser() redirects on.)
  if (session?.error === "RefreshAccessTokenError") return null;

  if (session?.user) {
    const preferredUsername = session.user.preferredUsername ?? "";
    const name =
      session.user.displayName ?? session.user.name ?? preferredUsername ?? "";

    // >>> APP-SPECIFIC: resolve a local identity here if needed, e.g.
    //   const id = await lookupLocalId(preferredUsername); // tolerate null
    return {
      preferredUsername,
      name,
      roles: session.roles ?? [],
      employeeNumber: session.user.employeeNumber ?? null,
      // id,
    };
  }

  return null;
});
