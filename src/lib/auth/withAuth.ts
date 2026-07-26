// Route-Handler wrapper for /api/* endpoints. PORTABLE — copy verbatim
// (destination filename: src/lib/auth/withAuth.ts).
//
// Usage:
//   export const POST = withAuth(async (req, ctx) => {...}, { role: "manager" });
//
// Behavior:
//   - 401 when there's no session
//   - 401 when session.error === "RefreshAccessTokenError" (terminal)
//   - 403 when a required role is missing
//   - else: handler runs with ctx.session injected
//
// CONTRACT with apiFetch (lib/api/client.ts): the 401 here is a real JSON 401,
// NEVER an HTML redirect — that is the signal apiFetch keys off to refresh-and-
// retry-once. A 401 caused purely by access-token expiry resolves on the retry
// (by then /api/auth/session + middleware have refreshed the cookie). A 403 is
// NOT an expiry case (valid session, missing role) and must stay a 403.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/../auth";
import { hasAnyRole, type AppRole } from "@/lib/auth/roles";
import type { Session } from "next-auth";

export interface WithAuthCtx {
  session: Session;
}

export interface WithAuthOptions {
  /** Required role(s). If multiple, ANY of them grants access. */
  role?: AppRole | AppRole[];
}

type Handler = (req: NextRequest, ctx: WithAuthCtx) => Promise<Response>;

export function withAuth(handler: Handler, options: WithAuthOptions = {}) {
  return async (req: NextRequest): Promise<Response> => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.error === "RefreshAccessTokenError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (options.role) {
      const required = Array.isArray(options.role) ? options.role : [options.role];
      if (!hasAnyRole(session.roles ?? [], required)) {
        return NextResponse.json({ error: "Forbidden", required }, { status: 403 });
      }
    }
    return handler(req, { session });
  };
}
