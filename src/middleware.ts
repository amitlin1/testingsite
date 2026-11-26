// Next.js middleware — gates every matched request:
//   - no session → bounce to Keycloak login (navigations) / 401 (data)
//   - role-protected route + missing role → /no-auth (nav) or 403 (data)
//   - server-action POST → pass through (it self-guards; middleware can't
//     redirect it anyway)
//   - everything else → pass through, forwarding a rotated session cookie
//
// LOCATION: this MUST live at src/middleware.ts when the project uses a src/
// dir — Next ignores a root-level middleware.ts then.
//
// RUNTIME: Edge (the middleware default). Everything here is Edge-safe:
// decode-jwt uses atob+TextDecoder (no Buffer), Auth.js v5 cookie decryption
// uses Web Crypto, refresh uses fetch.

import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEV_AUTH_BYPASS } from "@/lib/auth/current-session";
import { isDataRequest, resolveAccess } from "@/lib/routes";
import { SERVER_BASE_PATH, loginUrl, noAuthUrl, stripBasePath } from "@/lib/base-path";
import { forbidden, unauthorized } from "@/lib/auth/deny";
import {
  forwardRotatedSessionCookie,
  isLiveSession,
  isSessionCookieName,
  parseCookiePair,
} from "@/lib/auth/session";
import { authDebug, authStartupBanner } from "@/lib/auth/debug";

// SERVER_BASE_PATH is the basePath the app is mounted under (NEXT_BASE_PATH;
// unset for a root mount). NextRequest's `pathname` normally EXCLUDES it, but
// the redirects below need it to build absolute URLs.
authStartupBanner("middleware", {
  NEXT_BASE_PATH_ENV: process.env.NEXT_BASE_PATH ?? null,
  BASE_PATH_RESOLVED: SERVER_BASE_PATH,
});

function isServerAction(req: NextRequest): boolean {
  // A Server Action invoked from a client component is a POST carrying the
  // `next-action` header. Middleware CANNOT redirect a server action (a 3xx is
  // silently followed+discarded by the action's own fetch; a 401 throws inside
  // the action client) — so we let these through and the action's own
  // requireUser()/requirePermission() guard owns the dead-session redirect via an
  // in-action redirect() (x-action-redirect).
  return req.method === "POST" && req.headers.has("next-action");
}

function buildLoginRedirect(req: NextRequest, pathname: string): NextResponse {
  // Redirect to the server-side /login initiator, NOT /api/auth/signin/keycloak
  // (a GET there is unsupported in Auth.js v5 — see app/login/route.ts).
  const callbackTarget = SERVER_BASE_PATH + pathname + req.nextUrl.search;
  return NextResponse.redirect(new URL(loginUrl(callbackTarget), req.url));
}

// ---- Layer-A cooperation: forward the rotated session cookie ----
//
// Auth.js's auth() middleware wrapper refreshes the token and writes the rotated
// session cookie ONLY onto the RESPONSE — it does NOT propagate it to the
// downstream request. So the Server Component that runs next re-reads the OLD
// cookie and refreshes AGAIN. Under refresh-token ROTATION the second call uses
// a revoked token → invalid_grant → spurious logout. FIX: on a pass-through
// where a session cookie was rotated, rewrite the downstream request's `cookie`
// header to carry the NEW cookie — exactly one refresh per expiry boundary.
//
// The cookie can be CHUNKED (authjs.session-token.0/.1/…); the family is
// replaced atomically (forwardRotatedSessionCookie, lib/auth/session.ts).

// The session/routing decision. Kept as the next-auth auth() wrapper so it gets
// req.auth (and refreshes Layer-A on the response). The default export wraps THIS
// to add downstream cookie-forwarding.
const handleSession = auth((req) => {
  const session = req.auth;
  const roles: string[] | null = session?.roles ?? null;
  // Defensive basePath stripping. Some reverse-proxy deployments deliver the
  // pathname WITH the prefix and an empty nextUrl.basePath; if we don't strip it
  // ourselves, resolveAccess sees "/myapp/dashboard" not "/dashboard", /api/
  // detection misfires, and login callbackUrls double the prefix.
  const pathname = stripBasePath(req.nextUrl.pathname);
  // "The user is navigating" (redirect) vs "an XHR/API fetch" (JSON 401/403).
  const dataRequest = isDataRequest(pathname, req.headers);

  authDebug("middleware", "entered", {
    rawPathname: req.nextUrl.pathname,
    pathname,
    hasSession: !!session,
    sessionError: session?.error ?? null,
    rolesCount: roles?.length ?? null,
  });

  // Local dev without Keycloak (IS_DEV=1, never in a production build): every request is the
  // local user (current-session.ts), so there is nothing to check here.
  if (DEV_AUTH_BYPASS) {
    return NextResponse.next();
  }

  const verdict = resolveAccess(pathname, roles);

  // Public routes ALWAYS pass — checked BEFORE the error handler so a stale
  // session hitting /login (public) isn't redirected back to /login forever.
  if (verdict.kind === "public") {
    return NextResponse.next();
  }

  // Server Actions self-guard (requireUser/requirePermission) and can't be redirected
  // from here. Let them through — the auth() wrapper already ran Layer-A and the
  // cookie-forwarding still applies on the pass-through, so a merely-expired
  // token is refreshed transparently; a dead session is redirected by the
  // action's own requireUser().
  if (isServerAction(req)) {
    authDebug("middleware", "server action → pass through (self-guards)");
    return NextResponse.next();
  }

  // Non-public route with a session whose silent refresh failed terminally →
  // stale identity, force re-login.
  if (session && !isLiveSession(session)) {
    return dataRequest ? unauthorized() : buildLoginRedirect(req, pathname);
  }

  switch (verdict.kind) {
    case "allowed":
      return NextResponse.next();
    case "needs-auth":
      return dataRequest ? unauthorized() : buildLoginRedirect(req, pathname);
    case "forbidden":
      return dataRequest
        ? forbidden(verdict.required)
        : NextResponse.redirect(new URL(noAuthUrl(pathname), req.url));
  }
});

// Default export = routing decision PLUS downstream cookie-forwarding. Only
// genuine pass-throughs (200 + x-middleware-next) get the rotated cookie
// forwarded; redirects / JSON errors are returned untouched.
export default async function middleware(
  req: NextRequest,
  ev: NextFetchEvent,
): Promise<Response> {
  const res = (await handleSession(req as never, ev as never)) ?? NextResponse.next();

  const isPassThrough =
    res.status === 200 && res.headers.get("x-middleware-next") === "1";
  if (!isPassThrough) return res;

  const setCookies =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const rotatedSession = setCookies.filter((sc) => {
    const pair = parseCookiePair(sc);
    return pair ? isSessionCookieName(pair.name) : false;
  });
  if (rotatedSession.length === 0) return res;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(
    "cookie",
    forwardRotatedSessionCookie(req.headers.get("cookie") ?? "", rotatedSession),
  );

  authDebug("middleware", "forwarding rotated session cookie downstream", {
    rotatedCookieNames: rotatedSession.map((sc) => parseCookiePair(sc)?.name ?? "?").join(","),
  });

  const forwarded = NextResponse.next({ request: { headers: requestHeaders } });
  for (const sc of setCookies) forwarded.headers.append("set-cookie", sc);
  return forwarded;
}

// TWO patterns on purpose — a single "skip anything containing a dot" rule was
// an auth bypass:
//
//   GET /api/items/1.  →  still matches the [id] route (parseInt("1.") === 1),
//   but the pathname contains a dot, so middleware never ran and the handler —
//   which had no guard of its own — served the data to an anonymous caller.
//   Many /api routes still rely on this middleware alone.
//
// So: keep the extension skip for PAGES and static assets (an asset request must
// not be redirected to /login), and match EVERY /api route unconditionally.
// Cookieless server-to-server callers (/api/cron, /api/onlyoffice/callback,
// /api/files/download) stay reachable via PUBLIC_ROUTES in src/lib/routes.ts,
// which is checked first in the handler above — not via a pattern loophole.
//
// NOTE: matchers see the pathname with basePath already stripped. In the
// non-standard setup where a proxy does NOT strip it, /<base>/api/... is caught
// by the first pattern instead (it isn't "api/"-prefixed) — see the defensive
// basePath stripping in handleSession.
export const config = {
  matcher: [
    // Pages + assets: skip Auth.js internals, Next build output, and anything
    // that looks like a file (has an extension).
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\..*).*)",
    // Every API route except Auth.js's own — dots included.
    "/api/((?!auth).*)",
  ],
};
