// Server-initiated Keycloak login. PORTABLE — copy verbatim.
//
// WHY: in Auth.js v5, GET /api/auth/signin/:provider is NOT supported (throws
// UnknownAction). A browser redirect from middleware is always a GET, so it
// cannot point straight at /api/auth/signin/keycloak. Instead middleware
// redirects here, and we call the server-side signIn() (which performs the
// correct internal POST with skipCSRFCheck, sets PKCE/state cookies, and
// 307-redirects to Keycloak's authorize endpoint).
//
// FLOW: middleware (dead session) → /login?callbackUrl=... → signIn("keycloak",
// { redirectTo }) → 307 → Keycloak → /api/auth/callback/keycloak → back.

export const runtime = "nodejs";

import { signIn } from "@/../auth";
import { NextRequest, NextResponse } from "next/server";
import { normalizeBasePath } from "@/lib/base-path";
import { authDebug } from "@/lib/debug";

const NEXT_BASE = normalizeBasePath(process.env.NEXT_BASE_PATH);

function isNextRedirect(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "digest" in e &&
    typeof (e as { digest?: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("callbackUrl");
  // Accept only a same-app relative path that is NOT an auth endpoint and NOT
  // /login itself (rejecting /login is critical: a stale-session loop can nest a
  // callbackUrl pointing back at /login and re-loop). Fall back to the home/root.
  const safe =
    !!raw &&
    raw.startsWith("/") &&
    !raw.startsWith(`${NEXT_BASE}/api/auth`) &&
    !raw.startsWith(`${NEXT_BASE}/login`) &&
    !raw.startsWith("/login");
  const callbackUrl = safe ? raw : `${NEXT_BASE}/`;

  authDebug("login", "initiating keycloak signIn", {
    rawCallback: raw,
    usedCallback: callbackUrl,
  });

  try {
    // redirect:false → signIn returns the Keycloak authorization URL (a string)
    // instead of throwing NEXT_REDIRECT. It STILL sets the PKCE/state/nonce
    // cookies via next/headers cookies(), flushed onto the Response we return.
    const url = (await signIn("keycloak", {
      redirectTo: callbackUrl,
      redirect: false,
    })) as string | undefined;

    authDebug("login", "signIn produced url", {
      hasUrl: !!url,
      urlHost: url ? safeHost(url) : null,
    });

    if (!url) {
      return NextResponse.json(
        { error: "sign-in did not produce a redirect URL" },
        { status: 500 },
      );
    }
    return NextResponse.redirect(url);
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    // Real failure — almost always Keycloak discovery unreachable from inside
    // the container (DNS / connect). Log loudly; surface a 500.
    authDebug("login", "signIn threw", {
      err: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : null,
    });
    return NextResponse.json(
      {
        error: "sign-in failed",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

function safeHost(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}
