"use client";

// Browser fetch wrapper with the 401 → refresh → retry-once → redirect contract.
// PORTABLE — copy verbatim. Use this for any client-side call to an /api/*
// route handler wrapped with withAuth (which returns a JSON 401, never an HTML
// redirect — that 401 is the signal this keys off).
//
// Same-origin, cookie-based — never attaches an Authorization header. On a 401
// it forces a server-side refresh by hitting /api/auth/session with no-store
// (re-runs the jwt callback → refreshes + rewrites the cookie), then:
//   - if the session reports a TERMINAL error, skip the retry and go to /login;
//   - else retry the original request ONCE; a second 401 → full nav to /login.
//
// PITFALL: every URL goes through withBasePath() — native fetch does NOT respect
// Next's basePath.

import { withBasePath } from "@/lib/base-path";

const SESSION_ENDPOINT = withBasePath("/api/auth/session");
// Re-login goes through the server-side /login initiator, NOT directly to
// /api/auth/signin/keycloak (a GET there is unsupported in Auth.js v5).
const LOGIN_PATH = withBasePath("/login");

export interface ApiClientOptions extends RequestInit {
  /** Default true. Set false for endpoints that legitimately return 401. */
  retryOnUnauthorized?: boolean;
}

export async function apiFetch(
  input: string,
  init: ApiClientOptions = {},
): Promise<Response> {
  const { retryOnUnauthorized = true, ...fetchInit } = init;
  const url = withBasePath(input);
  const response = await fetch(url, { credentials: "same-origin", ...fetchInit });

  if (response.status !== 401 || !retryOnUnauthorized) return response;

  const sessionRes = await fetch(SESSION_ENDPOINT, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (await sessionReportsDeadSession(sessionRes)) {
    // Accepted trade-off: if Keycloak blips DURING this forced refresh, auth.ts
    // can degrade to terminal even though the session was fine, so we'd redirect
    // on a transient. Rare (the proactive poll normally prevents reaching true
    // expiry). When this util gets heavy use, consider retrying once before
    // trusting a terminal report.
    redirectToLogin();
    return response;
  }

  const retried = await fetch(url, { credentials: "same-origin", ...fetchInit });
  if (retried.status === 401) {
    redirectToLogin();
  }
  return retried;
}

/** True when /api/auth/session reports a terminal refresh failure. */
async function sessionReportsDeadSession(res: Response): Promise<boolean> {
  try {
    const data = (await res.clone().json()) as { error?: string } | null;
    return data?.error === "RefreshAccessTokenError";
  } catch {
    return false;
  }
}

/** Full-page navigation to the /login initiator, preserving the current path. */
function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const callback = window.location.pathname + window.location.search;
  window.location.href = `${LOGIN_PATH}?callbackUrl=${encodeURIComponent(callback)}`;
}
