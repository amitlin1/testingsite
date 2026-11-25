// What "signed in" means, and the Auth.js names the app has to know. Types are its only import:
// the edge middleware, the route guards and the browser all read it.
import type { Session } from "next-auth";

/** session.error once the silent refresh failed for good: the identity is stale, sign in again. */
export const TERMINAL_SESSION_ERROR = "RefreshAccessTokenError" as const;

/** The Auth.js session cookie; it can be chunked (<name>.0, <name>.1, …). */
const AUTHJS_SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"] as const;

/** The transient OAuth "check" cookies Auth.js sets when a login starts. */
export const AUTHJS_CHECK_COOKIES = [
  "authjs.pkce.code_verifier",
  "authjs.state",
  "authjs.nonce",
  "__Secure-authjs.pkce.code_verifier",
  "__Secure-authjs.state",
  "__Secure-authjs.nonce",
] as const;

/** IS_DEV=1 runs the app without Keycloak (current-session.ts) — never in a production build:
 *  `next build`/`next start` (and the Docker image) run with NODE_ENV=production. */
export function isDevAuthBypass(env: { IS_DEV?: string; NODE_ENV?: string }): boolean {
  return env.IS_DEV === "1" && env.NODE_ENV !== "production";
}

/** Signed in, and the silent refresh has not failed for good. */
export function isLiveSession(session: Session | null | undefined): session is Session {
  return !!session?.user && session.error !== TERMINAL_SESSION_ERROR;
}

/** The session cookie or one of its chunks (`<name>.0`, `<name>.1`, …), __Secure- variant included. */
export function isSessionCookieName(name: string): boolean {
  return AUTHJS_SESSION_COOKIES.some((base) => name === base || name.startsWith(base + "."));
}

/** The name and value a Set-Cookie header sets ("name=value; Path=/; …"); null without an "=". */
export function parseCookiePair(setCookie: string): { name: string; value: string } | null {
  const head = setCookie.split(";", 1)[0] ?? "";
  const eq = head.indexOf("=");
  if (eq === -1) return null;
  return { name: head.slice(0, eq).trim(), value: head.slice(eq + 1).trim() };
}

/** A request's Cookie header with its whole session-cookie family replaced by the one the
 *  Set-Cookie headers rotated in (a rotation that sets no value removes it); other cookies kept. */
export function forwardRotatedSessionCookie(originalCookieHeader: string, rotatedSetCookies: string[]): string {
  const kept = originalCookieHeader
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((kv) => {
      const eq = kv.indexOf("=");
      const name = (eq === -1 ? kv : kv.slice(0, eq)).trim();
      return !isSessionCookieName(name);
    });
  for (const sc of rotatedSetCookies) {
    const pair = parseCookiePair(sc);
    if (pair && isSessionCookieName(pair.name) && pair.value) {
      kept.push(`${pair.name}=${pair.value}`);
    }
  }
  return kept.join("; ");
}
