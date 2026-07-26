// Auth.js v5 — Keycloak production auth config. PORTABLE CORE.
// Destination: repo ROOT (auth.ts), NOT under src/.
//
// Strategy: JWT (encrypted cookie), NOT a DB session. Keycloak is the sole
// identity provider; this file plus middleware.ts handle every authn concern,
// while authorization lives in lib/auth/* + lib/routes.ts.
//
// ---- Known v5 pitfalls handled here ----
// 1. Keycloak's expires_at/expires_in are in SECONDS; Auth.js compares against
//    Date.now() (ms). We ×1000 on the way in. Forgetting this makes the token
//    look expired immediately and every page hammers the refresh endpoint.
// 2. Refresh-token rotation: Keycloak may or may not issue a new refresh_token.
//    Use the new one if present, else keep the old. Don't discard a working one.
// 3. On refresh failure: only a TERMINAL failure (invalid_grant) stamps
//    token.error; transient failures keep the session. Never throw from refresh.

import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { decodeJwtPayload } from "@/lib/auth/decode-jwt";
import { normalizeBasePath } from "@/lib/base-path";
import { authDebug, authStartupBanner } from "@/lib/debug";

// Auth.js needs its OWN basePath — it does NOT inherit Next's. Default is
// "/api/auth"; if the app is mounted at "/myapp", every URL is
// "/myapp/api/auth/..." and Auth.js throws UnknownAction (HTTP 400). Set
// NEXT_BASE_PATH to the mount name; leave unset for a root mount.
const NEXT_BASE = normalizeBasePath(process.env.NEXT_BASE_PATH);
const AUTH_BASE_PATH = `${NEXT_BASE}/api/auth`;

function derivePathFromAuthUrl(): string | null {
  const v = process.env.AUTH_URL;
  if (!v) return null;
  try {
    return new URL(v).pathname || null;
  } catch {
    return null;
  }
}

authStartupBanner("auth", {
  NEXT_BASE_PATH_ENV: process.env.NEXT_BASE_PATH ?? null,
  NEXT_BASE_RESOLVED: NEXT_BASE,
  AUTH_BASE_PATH_CONFIG: AUTH_BASE_PATH,
  AUTH_URL_PATHNAME: derivePathFromAuthUrl(),
  AUTH_KEYCLOAK_ISSUER: process.env.AUTH_KEYCLOAK_ISSUER ?? null,
  AUTH_SECRET_PRESENT: !!process.env.AUTH_SECRET,
  WILL_LOAD_KEYCLOAK_PROVIDER: !!(
    process.env.AUTH_KEYCLOAK_ID &&
    process.env.AUTH_KEYCLOAK_SECRET &&
    process.env.AUTH_KEYCLOAK_ISSUER
  ),
});

// Refresh proactively this many ms BEFORE the access token expires. 60s covers
// network round-trip + clock skew. Keep comfortably below the access-token TTL.
const REFRESH_LEEWAY_MS = 60_000;
// Per-attempt Keycloak token-endpoint timeout. 8s tolerates an occasionally-slow
// realm without misreading slowness as a dead session.
const REFRESH_TIMEOUT_MS = 8_000;
// One retry for a FAST transient failure (5xx / connection error). A timeout is
// NOT retried — retrying a timeout just doubles wall-clock — so worst-case added
// latency stays bounded at ~one timeout.
const REFRESH_RETRY_BACKOFF_MS = 300;
// During a Keycloak outage, don't re-attempt a network refresh more often than
// this (per isolate) while the access token is still usable — bounds load.
const REFRESH_BACKOFF_MS = 30_000;
// Clock-skew margin for the PROACTIVE refresh-token-deadline shortcut. Only
// short-circuit to "session dead" when comfortably PAST the deadline; nearer the
// boundary, attempt the real refresh and let Keycloak be the authority.
const REFRESH_DEADLINE_SKEW_MS = 60_000;

interface RefreshedTokens {
  access_token: string;
  expires_in: number; // SECONDS — access-token lifetime
  refresh_expires_in?: number; // SECONDS — refresh-token lifetime (Keycloak)
  refresh_token?: string;
  id_token?: string;
}

// Discriminated refresh outcome. The WHOLE point is to stop collapsing two very
// different failures into one `null`:
//   - terminal  → refresh token genuinely dead (Keycloak 400 invalid_grant) → re-login.
//   - retryable → Keycloak momentarily unreachable/slow/5xx, or config briefly
//                 unreadable. Session is probably FINE; logging the user out here
//                 is the #1 cause of spurious redirects. Keep token, try later.
type RefreshResult =
  | { ok: true; tokens: RefreshedTokens }
  | { ok: false; kind: "terminal" }
  | { ok: false; kind: "retryable" };

// Internal single-attempt result — carries `timedOut` so the retry layer can
// skip retrying a timeout (which would double the latency).
type RefreshAttempt =
  | { ok: true; tokens: RefreshedTokens }
  | { ok: false; kind: "terminal" }
  | { ok: false; kind: "retryable"; timedOut: boolean };

// SINGLE-FLIGHT: collapse concurrent refreshes of the SAME refresh_token within
// one Node process into ONE Keycloak call. With rotation OFF this is an
// efficiency win; with rotation ON it's correctness-critical (stops a second
// call spending a token the first would rotate away → invalid_grant → spurious
// logout). Single-node only; multi-instance + rotation ON needs a shared lock.
const inFlightRefreshes = new Map<string, Promise<RefreshResult>>();

function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  const existing = inFlightRefreshes.get(refreshToken);
  if (existing) {
    authDebug("auth:refresh-token", "joining in-flight refresh (single-flight)");
    return existing;
  }
  const p = refreshWithRetry(refreshToken).finally(() => {
    inFlightRefreshes.delete(refreshToken);
  });
  inFlightRefreshes.set(refreshToken, p);
  return p;
}

// Retry layer: one extra attempt for a FAST transient failure; never retry a
// timeout (bounded latency) or a terminal invalid_grant (pointless).
async function refreshWithRetry(refreshToken: string): Promise<RefreshResult> {
  let last: RefreshAttempt = { ok: false, kind: "retryable", timedOut: false };
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await attemptRefresh(refreshToken, attempt);
    if (last.ok) return { ok: true, tokens: last.tokens };
    if (last.kind === "terminal") return { ok: false, kind: "terminal" };
    if (last.timedOut || attempt === 2) break;
    await new Promise((r) => setTimeout(r, REFRESH_RETRY_BACKOFF_MS));
  }
  return { ok: false, kind: "retryable" };
}

// One POST to Keycloak's token endpoint. CLASSIFIES the outcome:
//   - HTTP 400 invalid_grant            → terminal (refresh token genuinely dead)
//   - any other non-2xx (5xx, 401, ...) → retryable (incl. invalid_client = a
//                                          config problem, NOT the user's fault)
//   - timeout / network / DNS / TLS     → retryable, timedOut flag set
//   - missing config                    → retryable (don't evict on a config blip)
async function attemptRefresh(
  refreshToken: string,
  attempt: number,
): Promise<RefreshAttempt> {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
  const clientId = process.env.AUTH_KEYCLOAK_ID;
  const clientSecret = process.env.AUTH_KEYCLOAK_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    authDebug("auth:refresh-token", "missing keycloak config → retryable", {
      hasIssuer: !!issuer,
      hasClientId: !!clientId,
      hasSecret: !!clientSecret,
    });
    return { ok: false, kind: "retryable", timedOut: false };
  }

  const tokenUrl = `${issuer}/protocol/openid-connect/token`;
  const startedAt = Date.now();
  authDebug("auth:refresh-token", "POST refresh →", {
    tokenUrl,
    clientId,
    attempt,
    refreshTokenLen: refreshToken.length,
  });

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      // Fail fast instead of hanging the JWT callback (and the request /
      // middleware) if Keycloak is slow or unreachable.
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // ONLY a 400 invalid_grant means the refresh token is genuinely dead — the
      // one case that should log the user out. Everything else (5xx, 401
      // invalid_client, ...) is a server/config problem the user can't fix.
      const isInvalidGrant =
        res.status === 400 && /"error"\s*:\s*"invalid_grant"/.test(errBody);
      authDebug(
        "auth:refresh-token",
        isInvalidGrant
          ? "✗ TERMINAL — invalid_grant (refresh token dead)"
          : "✗ retryable — non-2xx from keycloak",
        { status: res.status, elapsedMs: Date.now() - startedAt, body: errBody.slice(0, 500) },
      );
      return isInvalidGrant
        ? { ok: false, kind: "terminal" }
        : { ok: false, kind: "retryable", timedOut: false };
    }
    const json = (await res.json()) as RefreshedTokens;
    authDebug("auth:refresh-token", "✓ keycloak refresh OK", {
      elapsedMs: Date.now() - startedAt,
      accessTokenLifetimeSec: json.expires_in,
      refreshTokenLifetimeSec: json.refresh_expires_in ?? null,
      rotatedRefreshToken: !!json.refresh_token,
    });
    return { ok: true, tokens: json };
  } catch (err) {
    // NEVER throw. A network blip / timeout must degrade to a RETRYABLE result.
    // AbortSignal.timeout() aborts with a DOMException named "TimeoutError" (only
    // a manual AbortController.abort() yields "AbortError") — accept BOTH so a
    // genuine timeout is flagged and therefore NOT retried.
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    authDebug("auth:refresh-token", "✗ retryable — fetch threw", {
      elapsedMs: Date.now() - startedAt,
      timedOut,
      name: err instanceof Error ? err.name : null,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, kind: "retryable", timedOut };
  }
}

// When the Keycloak vars aren't all set, ship NextAuth with no providers so the
// app can run on a dev path without crashing every request with InvalidEndpoints.
const keycloakConfigured =
  !!process.env.AUTH_KEYCLOAK_ID &&
  !!process.env.AUTH_KEYCLOAK_SECRET &&
  !!process.env.AUTH_KEYCLOAK_ISSUER;

// kc_idp_hint — route straight to a brokered IdP for seamless login. In OUR
// realm there is no brokered IdP: users sign in with username + password on
// Keycloak's own (themed) login page. So AUTH_KEYCLOAK_IDP_HINT is left EMPTY
// in the env, which suppresses kc_idp_hint entirely. (The DigitalFactory realm
// the skill shipped with defaulted this to "iis-sso" — not applicable here.)
const idpHint = process.env.AUTH_KEYCLOAK_IDP_HINT ?? "";
const keycloakAuthParams: Record<string, string> = { scope: "openid profile email" };
if (idpHint) keycloakAuthParams.kc_idp_hint = idpHint;

// Roles can be REALM roles (realm_access.roles) OR CLIENT roles
// (resource_access[clientId].roles). Read and MERGE both — a user whose roles
// are client-scoped would otherwise have zero permissions. Merging only ADDS.
function rolesFromAccessToken(payload: {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}): string[] {
  const realm = payload.realm_access?.roles ?? [];
  const clientId = process.env.AUTH_KEYCLOAK_ID;
  const client = clientId ? (payload.resource_access?.[clientId]?.roles ?? []) : [];
  return Array.from(new Set([...realm, ...client]));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: AUTH_BASE_PATH,
  session: { strategy: "jwt" },
  trustHost: true,
  // Send Auth.js errors to our self-healing handler instead of the dead built-in
  // "Server error / Configuration" page. A "Configuration" error is almost always
  // a stale/interrupted PKCE cookie (expired session + a fresh login, or multiple
  // tabs) — /auth-error clears the stale check cookies and restarts a clean login.
  pages: { error: "/auth-error" },
  providers: keycloakConfigured
    ? [
        Keycloak({
          clientId: process.env.AUTH_KEYCLOAK_ID,
          clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
          issuer: process.env.AUTH_KEYCLOAK_ISSUER,
          authorization: { params: keycloakAuthParams },
        }),
      ]
    : [],
  callbacks: {
    /**
     * Runs on every request that needs a session. Phases:
     *   (a) initial sign-in: populate token
     *   (b) still valid: return token unchanged
     *   (c) refresh window: proactive refresh with the hardened classification
     */
    async jwt({ token, account }) {
      // (a) Initial sign-in — `account` is the OAuth response shape.
      if (account) {
        token.access_token = account.access_token;
        token.refresh_token = account.refresh_token;
        token.id_token = account.id_token;
        const expSec =
          typeof account.expires_at === "number"
            ? account.expires_at
            : typeof account.expires_in === "number"
              ? Math.floor(Date.now() / 1000) + account.expires_in
              : Math.floor(Date.now() / 1000) + 300;
        token.expires_at = expSec * 1000; // seconds → ms (pitfall #1)

        // Store the REFRESH-token / SSO-session deadline (when Keycloak sends
        // it) so the callback can recognise a dead session WITHOUT a wasted
        // round-trip. refresh_expires_in isn't on the typed Account — read it
        // defensively.
        const acctRefreshExpiresIn = (account as Record<string, unknown>).refresh_expires_in;
        if (typeof acctRefreshExpiresIn === "number") {
          token.refresh_expires_at =
            (Math.floor(Date.now() / 1000) + acctRefreshExpiresIn) * 1000;
        }

        // Cache identity claims from the ACCESS token — realm_access lives there.
        if (account.access_token) {
          const payload = decodeJwtPayload(account.access_token);
          if (payload) {
            token.preferred_username = payload.preferred_username;
            token.roles = rolesFromAccessToken(payload);
            token.profile = payload.profile;
            token.name = payload.name;
            token.email = payload.email;
            token.employee_number = payload.employee_number;
          }
        }
        return token;
      }

      // Defensive: if expires_at isn't numeric (cookie corruption / older shape),
      // recover it from the access token's own `exp` claim rather than refreshing
      // on EVERY request (the "Keycloak-hammering" pitfall).
      if (typeof token.expires_at !== "number" && token.access_token) {
        const claims = decodeJwtPayload(token.access_token);
        if (typeof claims?.exp === "number") token.expires_at = claims.exp * 1000;
      }

      // (b) Token still valid (with leeway) → reuse.
      if (
        typeof token.expires_at === "number" &&
        Date.now() < token.expires_at - REFRESH_LEEWAY_MS
      ) {
        return token;
      }

      // (c) Refresh window. FIRST: is the SESSION already dead? If past the
      // refresh-token deadline (with a clock-skew margin), the refresh can't
      // succeed — stamp terminal with no network call. Within the margin, fall
      // through and let Keycloak be the authority (a fast clock mustn't evict).
      if (
        typeof token.refresh_expires_at === "number" &&
        Date.now() >= token.refresh_expires_at + REFRESH_DEADLINE_SKEW_MS
      ) {
        authDebug("auth:jwt-cb", "past refresh_expires_at (+skew) → terminal");
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      // Backoff: if a recent attempt failed transiently AND the access token is
      // still usable (inside leeway, not past true expiry), reuse it instead of
      // re-hitting Keycloak every request during an outage. A later request retries.
      if (
        typeof token.expires_at === "number" &&
        Date.now() < token.expires_at &&
        typeof token.lastRefreshAttemptAt === "number" &&
        Date.now() - token.lastRefreshAttemptAt < REFRESH_BACKOFF_MS
      ) {
        authDebug("auth:jwt-cb", "within refresh backoff window → reuse token");
        return token;
      }

      if (!token.refresh_token) {
        authDebug("auth:jwt-cb", "no refresh_token → terminal");
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      const result = await refreshAccessToken(token.refresh_token);

      // SUCCESS → apply new tokens, clear any prior error.
      if (result.ok) {
        const refreshed = result.tokens;
        token.access_token = refreshed.access_token;
        token.expires_at = (Math.floor(Date.now() / 1000) + refreshed.expires_in) * 1000;
        if (typeof refreshed.refresh_expires_in === "number") {
          token.refresh_expires_at =
            (Math.floor(Date.now() / 1000) + refreshed.refresh_expires_in) * 1000;
        }
        // Rotation (pitfall #2): keep the old refresh_token if none was issued.
        if (refreshed.refresh_token) token.refresh_token = refreshed.refresh_token;
        if (refreshed.id_token) token.id_token = refreshed.id_token;
        delete token.error;
        delete token.lastRefreshAttemptAt;

        // Re-cache identity claims (roles can change between refreshes).
        const payload = decodeJwtPayload(refreshed.access_token);
        if (payload) {
          token.preferred_username = payload.preferred_username;
          token.roles = rolesFromAccessToken(payload);
          token.profile = payload.profile;
          token.name = payload.name;
          token.email = payload.email;
          token.employee_number = payload.employee_number;
        }
        authDebug("auth:jwt-cb", "✓ refresh applied", { newExpiresAtMs: token.expires_at });
        return token;
      }

      // TERMINAL → refresh token genuinely dead. Re-login is correct.
      if (result.kind === "terminal") {
        authDebug("auth:jwt-cb", "✗ refresh TERMINAL (invalid_grant)");
        return { ...token, error: "RefreshAccessTokenError" as const };
      }

      // RETRYABLE → Keycloak momentarily unreachable/slow. Do NOT log out while
      // the access token is still valid; retry on a later request. Only degrade
      // to terminal if the access token has ALREADY passed true expiry.
      token.lastRefreshAttemptAt = Date.now();
      if (typeof token.expires_at === "number" && Date.now() < token.expires_at) {
        authDebug("auth:jwt-cb", "retryable but token still valid → proceed");
        return token;
      }
      authDebug("auth:jwt-cb", "retryable AND token expired → degrade to terminal");
      return { ...token, error: "RefreshAccessTokenError" as const };
    },

    /** Project the JWT onto the Session the client sees. */
    async session({ session, token }) {
      session.roles = token.roles ?? [];
      session.accessToken = token.access_token;
      // Expose id_token so the client logout helper can pass it as id_token_hint.
      session.idToken = token.id_token;
      session.error = token.error;
      session.user = {
        ...session.user,
        preferredUsername: token.preferred_username ?? "",
        displayName: token.profile?.display_name ?? token.name ?? undefined,
        // Pass through standard name/email if Auth.js didn't fill them.
        name: session.user?.name ?? token.name ?? null,
        email: session.user?.email ?? token.email ?? null,
        // מספר עובד — used to auto-resolve the logged-in worker (see future task).
        employeeNumber: token.employee_number ?? null,
      };
      return session;
    },
  },
});
