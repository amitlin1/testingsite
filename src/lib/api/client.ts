"use client";

// Browser fetch wrapper with the 401 → refresh → retry-once → redirect contract.
// Use this for any client-side call to an /api/* route handler (withAuth and the
// middleware answer a JSON 401, never an HTML redirect — that 401 is the signal
// this keys off).
//
// Same-origin, cookie-based — never attaches an Authorization header. On a 401
// it forces a server-side refresh by hitting /api/auth/session with no-store
// (re-runs the jwt callback → refreshes + rewrites the cookie), then:
//   - if the session reports a TERMINAL error, skip the retry and go to /login;
//   - else retry the original request ONCE; a second 401 → full nav to /login.
//
// PITFALL: every URL goes through withBasePath() — native fetch does NOT respect
// Next's basePath.

import { loginUrl, withBasePath } from "@/lib/base-path";
import { TERMINAL_SESSION_ERROR } from "@/lib/auth/session";

const SESSION_ENDPOINT = withBasePath("/api/auth/session");

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
    // expiry). Retrying once before trusting a terminal report is an open owner
    // decision (docs/decisions/untangle/DECISIONS.md, "Not done on purpose").
    redirectToLogin();
    return response;
  }

  const retried = await fetch(url, { credentials: "same-origin", ...fetchInit });
  if (retried.status === 401) {
    redirectToLogin();
  }
  return retried;
}

async function sessionReportsDeadSession(res: Response): Promise<boolean> {
  try {
    const data = (await res.clone().json()) as { error?: string } | null;
    return data?.error === TERMINAL_SESSION_ERROR;
  } catch {
    return false;
  }
}

/** To the /login initiator (not /api/auth/signin/keycloak: a GET there is unsupported in Auth.js
 *  v5), returning to the current path. */
function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.href = loginUrl(window.location.pathname + window.location.search);
}

/** A non-2xx answer: `status`, the server's `error` text as the message, and its whole JSON body. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

/** GET a JSON body; throws ApiError with the server's message (`failMessage` when it sent none). */
export async function getJson<T>(url: string, failMessage = "הטעינה נכשלה"): Promise<T> {
  const res = await apiFetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string })?.error || failMessage, body as Record<string, unknown>);
  return body as T;
}

/** GET a JSON array; an answer that is not an array (and not an error) counts as no rows. */
export async function getArray<T>(url: string, failMessage?: string): Promise<T[]> {
  const data = await getJson<unknown>(url, failMessage);
  return Array.isArray(data) ? (data as T[]) : [];
}

/** POST / PUT / PATCH / DELETE with a JSON body; throws ApiError with the server's message
 *  (`failMessage` when it sent none). */
export async function sendJson<T = Record<string, unknown>>(
  url: string,
  method: string,
  body?: unknown,
  failMessage = "הפעולה נכשלה",
): Promise<T> {
  const res = await apiFetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error || failMessage, data as Record<string, unknown>);
  return data as T;
}
