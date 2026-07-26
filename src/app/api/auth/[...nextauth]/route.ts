// Auth.js v5 route handlers — mounts sign-in / callback / session under
// ${basePath}/api/auth/*. The handlers come from the NextAuth() config in the
// repo-root auth.ts. PORTABLE — copy verbatim.
//
// NEXT 16 basePath FIX (the "UnknownAction: Cannot parse action at
// /api/auth/callback/keycloak" bug + repeated `env-url-basepath-mismatch`
// warnings):
//   Next 16 STRIPS the next.config `basePath` from the request URL BEFORE a
//   route handler runs (Next 15 did NOT). Auth.js is configured with basePath
//   `/<NEXT_BASE_PATH>/api/auth` — necessary so it GENERATES a redirect_uri that
//   matches the Keycloak client — but it then receives an incoming path of just
//   `/api/auth/...` and cannot parse the action.
//
//   Fix: re-prepend the stripped basePath to the request URL before handing it
//   to Auth.js. Parsing matches the configured basePath again, while URL
//   GENERATION (redirect_uri, signin/callback) keeps the full public prefix.
//
//   On a ROOT mount (NEXT_BASE_PATH unset — our dev setup) this wrapper is a
//   no-op.

import { NextRequest } from "next/server";
import { handlers } from "@/../auth";
import { normalizeBasePath } from "@/lib/base-path";

const BASE = normalizeBasePath(process.env.NEXT_BASE_PATH);

/** Re-prepend the basePath Next 16 stripped, so Auth.js can parse the action. */
function withBase(req: NextRequest): NextRequest {
  if (!BASE) return req;
  const url = new URL(req.url);
  // Idempotent: only add the prefix if it isn't already there.
  if (url.pathname === BASE || url.pathname.startsWith(BASE + "/")) return req;
  url.pathname = BASE + url.pathname;
  // Reconstruct at the prefixed URL, reusing the original request as init so
  // method / headers / body are preserved.
  return new NextRequest(url.toString(), req);
}

export const GET = (req: NextRequest) => handlers.GET(withBase(req));
export const POST = (req: NextRequest) => handlers.POST(withBase(req));
