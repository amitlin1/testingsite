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
// RUNTIME: Edge (default). Do NOT add `export const runtime = "nodejs"` — Node
// middleware needs an experimental flag on Next 15.x. Everything here is
// Edge-safe: decode-jwt uses atob+TextDecoder (no Buffer), Auth.js v5 cookie
// decryption uses Web Crypto, refresh uses fetch.

import type { NextRequest, NextFetchEvent } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { resolveAccess } from "@/lib/routes";
import { normalizeBasePath } from "@/lib/base-path";
import { authDebug, authStartupBanner } from "@/lib/debug";

// basePath the app is mounted under. `pathname` from NextRequest normally
// EXCLUDES it (Next strips automatically), but we need it to build absolute
// redirect URLs and to defensively strip it (see pathWithoutBase). Leave
// NEXT_BASE_PATH unset for a root mount.
const BASE_PATH = normalizeBasePath(process.env.NEXT_BASE_PATH);

authStartupBanner("middleware", {
  NEXT_BASE_PATH_ENV: process.env.NEXT_BASE_PATH ?? null,
  BASE_PATH_RESOLVED: BASE_PATH,
});

// Defensive basePath stripping. Some reverse-proxy deployments deliver the
// pathname WITH the prefix and an empty nextUrl.basePath; if we don't strip it
// ourselves, resolveAccess sees "/myapp/dashboard" not "/dashboard", /api/
// detection misfires, and login callbackUrls double the prefix. Idempotent.
function pathWithoutBase(pathname: string): string {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "/";
  if (pathname.startsWith(BASE_PATH + "/")) return pathname.slice(BASE_PATH.length);
  return pathname;
}

function isApiOrDataRequest(req: NextRequest): boolean {
  // Distinguish "the user is navigating" (HTML or an RSC client navigation)
  // from "an XHR/API fetch" — the response shape differs (redirect vs 401).
  if (pathWithoutBase(req.nextUrl.pathname).startsWith("/api/")) return true;

  // Client-side <Link>/router navigations send an RSC fetch carrying the `rsc`
  // header but NOT sec-fetch-mode:navigate and NOT Accept:text/html. Treat them
  // as navigations so they get a proper redirect (which the App Router turns
  // into a hard navigation) — a JSON 401 would freeze the UI.
  if (req.headers.has("rsc")) return false;

  const accept = req.headers.get("accept") ?? "";
  const fetchMode = req.headers.get("sec-fetch-mode") ?? "";
  if (fetchMode === "navigate") return false;
  if (accept.includes("text/html")) return false;
  return true;
}

function isServerAction(req: NextRequest): boolean {
  // A Server Action invoked from a client component is a POST carrying the
  // `next-action` header. Middleware CANNOT redirect a server action (a 3xx is
  // silently followed+discarded by the action's own fetch; a 401 throws inside
  // the action client) — so we let these through and the action's own
  // requireUser()/requireRole() guard owns the dead-session redirect via an
  // in-action redirect() (x-action-redirect).
  return req.method === "POST" && req.headers.has("next-action");
}

function buildLoginRedirect(req: NextRequest): NextResponse {
  // Redirect to the server-side /login initiator, NOT /api/auth/signin/keycloak
  // (a GET there is unsupported in Auth.js v5 — see app/login/route.ts).
  const cleanPath = pathWithoutBase(req.nextUrl.pathname);
  const callbackTarget = BASE_PATH + cleanPath + req.nextUrl.search;
  const loginUrl = new URL(`${BASE_PATH}/login`, req.url);
  loginUrl.searchParams.set("callbackUrl", callbackTarget);
  return NextResponse.redirect(loginUrl);
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
// The cookie can be CHUNKED (authjs.session-token.0/.1/…); the family must be
// replaced atomically. __Secure- variants handled too.
const SESSION_COOKIE_BASES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function isSessionCookieName(name: string): boolean {
  return SESSION_COOKIE_BASES.some((base) => name === base || name.startsWith(base + "."));
}

function parseCookiePair(setCookie: string): { name: string; value: string } | null {
  const head = setCookie.split(";", 1)[0] ?? "";
  const eq = head.indexOf("=");
  if (eq === -1) return null;
  return { name: head.slice(0, eq).trim(), value: head.slice(eq + 1).trim() };
}

function forwardRotatedSessionCookie(
  originalCookieHeader: string,
  rotatedSetCookies: string[],
): string {
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

// The session/routing decision. Kept as the next-auth auth() wrapper so it gets
// req.auth (and refreshes Layer-A on the response). The default export wraps THIS
// to add downstream cookie-forwarding.
const handleSession = auth((req) => {
  const session = req.auth;
  const roles: string[] | null = session?.roles ?? null;
  const pathname = pathWithoutBase(req.nextUrl.pathname);

  authDebug("middleware", "entered", {
    rawPathname: req.nextUrl.pathname,
    pathname,
    hasSession: !!session,
    sessionError: session?.error ?? null,
    rolesCount: roles?.length ?? null,
  });

  // Local-dev bypass. When IS_DEV=1 there is no Keycloak, so the auth checks
  // below would redirect every page to /login → signIn → hard failure. Bypass
  // UNCONDITIONALLY in dev. Hard-gated on IS_DEV — empty in prod, so this cannot
  // bypass auth there. NOTE: we run WITHOUT IS_DEV locally (we DO have a local
  // Keycloak), so the real flow is exercised in dev; set IS_DEV=1 only if you
  // want to work on non-auth pages without logging in.
  if (process.env.IS_DEV === "1") {
    return NextResponse.next();
  }

  const verdict = resolveAccess(pathname, roles);

  // Public routes ALWAYS pass — checked BEFORE the error handler so a stale
  // session hitting /login (public) isn't redirected back to /login forever.
  if (verdict.kind === "public") {
    return NextResponse.next();
  }

  // Server Actions self-guard (requireUser/requireRole) and can't be redirected
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
  if (session?.error === "RefreshAccessTokenError") {
    if (isApiOrDataRequest(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return buildLoginRedirect(req);
  }

  switch (verdict.kind) {
    case "allowed":
      return NextResponse.next();
    case "needs-auth": {
      if (isApiOrDataRequest(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return buildLoginRedirect(req);
    }
    case "forbidden": {
      if (isApiOrDataRequest(req)) {
        return NextResponse.json(
          { error: "Forbidden", required: verdict.required },
          { status: 403 },
        );
      }
      const noAuthUrl = new URL(`${BASE_PATH}/no-auth`, req.url);
      noAuthUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(noAuthUrl);
    }
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

// Matcher excludes Auth.js routes, build assets, favicon, and any path with a
// file extension.
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
