// Auth.js v5 module augmentation. TEMPLATE — the refresh/role fields are
// portable; add app-specific session.user fields where marked.
//
// Import it once (e.g. in auth.ts) to pick up these types app-wide.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** Keycloak preferred_username, projected in auth.ts's session callback. */
      preferredUsername: string;
      displayName?: string;
      /** מספר עובד — Keycloak custom attribute, projected in auth.ts. */
      employeeNumber?: string | null;
      // >>> APP-SPECIFIC: add custom user fields you project in the session
      // callback (e.g. a local id, rank, title).
    } & DefaultSession["user"];
    /** Merged realm + client roles. */
    roles: string[];
    /** Raw access token — only needed if calling external resource servers. */
    accessToken?: string;
    /** Raw id token — passed as id_token_hint to Keycloak RP-initiated logout. */
    idToken?: string;
    /** Set to "RefreshAccessTokenError" when silent refresh terminally failed.
     *  Consumers redirect to login on this. DO NOT remove. */
    error?: "RefreshAccessTokenError";
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
      rank?: string;
      title?: string;
    };
    name?: string;
    email?: string;
    employee_number?: string;
    error?: "RefreshAccessTokenError";
  }
}
