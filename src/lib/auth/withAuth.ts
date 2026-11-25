// Route-Handler wrapper for /api/* endpoints.
//
// Usage:
//   export const POST = withAuth(async (req, { session }) => {...}, { role: ACCESS.dashboard });
//   export const PUT = withAuth<{ id: string }>(async (req, { session, params }) => {...});
//
// Behavior:
//   - 401 when there's no live session (none, or session.error is terminal — isLiveSession)
//   - 403 when a required role is missing
//   - else: the handler runs with the session and Next's route params (already awaited)
//
// CONTRACT with apiFetch (lib/api/client.ts): the 401 here is a real JSON 401,
// NEVER an HTML redirect — that is the signal apiFetch keys off to refresh-and-
// retry-once. A 401 caused purely by access-token expiry resolves on the retry
// (by then /api/auth/session + middleware have refreshed the cookie). A 403 is
// NOT an expiry case (valid session, missing role) and must stay a 403.

import type { NextRequest } from "next/server";
import { currentSession } from "@/lib/auth/current-session";
import { forbidden, unauthorized } from "@/lib/auth/deny";
import { hasAnyRole, type AppRole } from "@/lib/auth/roles";
import { isLiveSession } from "@/lib/auth/session";
import type { Session } from "next-auth";

/** A route's dynamic segments, as Next names them: [id] → string, [...path] → string[]. */
export type RouteParams = Record<string, string | string[]>;

export interface WithAuthCtx<P extends RouteParams = Record<string, never>> {
  session: Session;
  /** Next's route params; {} for a route without dynamic segments. */
  params: P;
}

export interface WithAuthOptions {
  /** Required role(s) — an ACCESS entry. If several, ANY of them grants access. */
  role?: readonly AppRole[];
}

export function withAuth<P extends RouteParams = Record<string, never>>(
  handler: (req: NextRequest, ctx: WithAuthCtx<P>) => Promise<Response>,
  options: WithAuthOptions = {},
) {
  return async (req: NextRequest, routeCtx?: { params?: Promise<P> }): Promise<Response> => {
    const session = await currentSession();
    if (!isLiveSession(session)) {
      return unauthorized();
    }
    if (options.role && !hasAnyRole(session.roles ?? [], options.role)) {
      return forbidden(options.role);
    }
    const params = ((await routeCtx?.params) ?? {}) as P;
    return handler(req, { session, params });
  };
}
