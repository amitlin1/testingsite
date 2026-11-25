// The access token's lifetime and the two timers built around it, side by side because they must
// agree: the browser polls the session just under the lifetime, so each poll lands inside the
// server's refresh window and a tab sitting idle never reaches an expired token.

/** The `testing` realm's access-token lifespan (Keycloak: Realm settings → Tokens). Set there,
 *  mirrored here. */
const ACCESS_TOKEN_TTL_SECONDS = 900;

/** auth.ts refreshes this long BEFORE the access token expires: a round trip plus clock skew.
 *  Keep it comfortably below the TTL. */
export const REFRESH_LEEWAY_MS = 60_000;

/** SessionProvider's poll of /api/auth/session (which re-runs the jwt callback): the TTL less the
 *  leeway, 840 s. */
export const SESSION_REFETCH_SECONDS = ACCESS_TOKEN_TTL_SECONDS - REFRESH_LEEWAY_MS / 1000;
