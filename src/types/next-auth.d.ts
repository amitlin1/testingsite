// Auth.js v5 module augmentation: the session and JWT fields auth.ts sets. Ambient
// (tsconfig includes it), so it is imported nowhere.

import type { DefaultSession } from "next-auth";
import type { TERMINAL_SESSION_ERROR } from "@/lib/auth/session";

declare module "next-auth" {
  interface Session {
    user: {
      /** Keycloak preferred_username, projected in auth.ts's session callback. */
      preferredUsername: string;
      displayName?: string;
      /** מספר עובד — Keycloak custom attribute, projected in auth.ts. */
      employeeNumber?: string | null;
    } & DefaultSession["user"];
    /** Merged realm + client roles. */
    roles: string[];
    // NOTE: the raw access token is intentionally absent. Projecting it would
    // expose a live bearer token through /api/auth/session (see auth.ts).
    /** Raw id token — passed as id_token_hint to Keycloak RP-initiated logout. */
    idToken?: string;
    /** Set to "RefreshAccessTokenError" when silent refresh terminally failed.
     *  Consumers redirect to login on this. DO NOT remove. */
    error?: typeof TERMINAL_SESSION_ERROR;
  }
}

// Auth.js v5 ships JWT from @auth/core/jwt; augmentation must target that module.
declare module "@auth/core/jwt" {
  interface JWT {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    /** ACCESS-token expiry, ms since epoch (Keycloak gives seconds; auth.ts ×1000). */
    expires_at?: number;
    /** REFRESH-token / SSO-session deadline, ms since epoch, from Keycloak's
     *  refresh_expires_in. Powers the proactive dead-session shortcut. DO NOT
     *  remove. */
    refresh_expires_at?: number;
    /** ms of the last transient refresh failure; gates the outage backoff. */
    lastRefreshAttemptAt?: number;
    roles?: string[];
    preferred_username?: string;
    profile?: {
      display_name?: string;
    };
    name?: string;
    email?: string;
    employee_number?: string;
    error?: typeof TERMINAL_SESSION_ERROR;
  }
}
