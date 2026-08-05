// RP-Initiated logout initiator — RUNTIME issuer resolution.
//
// WHY THIS ROUTE EXISTS: the Keycloak issuer used to be read client-side from
// NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER, which `next build` inlines into the static
// JS bundle. That makes the built image environment-SPECIFIC — the air-gap tar
// would carry the dev URL and no amount of .env editing in production could
// change it. A route handler is always rendered per-request, so reading
// process.env here resolves at RUNTIME: one image, any environment.
//
// Public (see PUBLIC_ROUTES) — the caller has already cleared its local session
// via signOut() by the time it lands here, so a gated route would bounce it to
// /login and the Keycloak SSO cookie would survive.
//
// Builds no state and touches no DB: it only assembles Keycloak's end-session
// URL and 302s to it.

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
// Never prerender/cache: the whole point is a fresh process.env read per request.
export const dynamic = "force-dynamic";

const FALLBACK_ISSUER = "http://localhost:8080/realms/testing";

export function GET(request: NextRequest) {
  const issuer = (process.env.AUTH_KEYCLOAK_ISSUER || FALLBACK_ISSUER).replace(/\/+$/, "");

  const params = new URLSearchParams();

  const idTokenHint = request.nextUrl.searchParams.get("id_token_hint");
  if (idTokenHint) params.set("id_token_hint", idTokenHint);

  // Taken from the caller because only the browser knows the origin it reached
  // us on (behind nginx, the server sees the internal host). This is NOT an open
  // redirect: Keycloak validates post_logout_redirect_uri against the client's
  // registered post-logout URIs and refuses anything else.
  const postLogout = request.nextUrl.searchParams.get("post_logout_redirect_uri");
  if (postLogout) params.set("post_logout_redirect_uri", postLogout);

  return NextResponse.redirect(
    `${issuer}/protocol/openid-connect/logout?${params.toString()}`,
  );
}
