// Route protection map — single source of truth for the middleware.
//
// Pattern matching is prefix-only (startsWith). Pages can import these to mirror
// the same decision (e.g. a "you need role X" empty state).

import type { AppRole } from "@/lib/auth/roles";
import { hasAnyRole } from "@/lib/auth/roles";

// Routes that don't require a session. /login and /no-auth MUST stay here, or
// the middleware redirects them to themselves — an infinite loop.
//
// The /api/* entries below are SERVER-TO-SERVER endpoints called with no browser
// session cookie, so the session middleware must let them through; each one
// authenticates ITSELF:
//   - /api/cron                → cronSecretGuard() (CRON_SECRET shared secret)
//   - /api/onlyoffice/callback → verifies the OnlyOffice-signed JWT internally
//   - /api/files/download      → fetched by the (cookieless) OnlyOffice doc server
// NOTE (pending hardening, tracked separately): /api/files/download has no auth
// of its own yet — browser file access is not gated. Adding a signed-URL / role
// check there is the "file-route security posture" follow-up.
export const PUBLIC_ROUTES: readonly string[] = [
  "/no-auth",
  "/login",
  "/auth-error", // self-healing Auth.js error handler (must bypass the auth gate)
  "/api/cron",
  "/api/onlyoffice/callback",
  "/api/files/download",
];

// Path-prefix → required roles (ANY grants access). First match wins; list
// longest/most-specific prefixes first when they overlap. Routes NOT listed here
// are allowed for ANY authenticated user. Anything gated by DB state rather than
// a Keycloak role should NOT live here — let any authed user through the
// middleware and gate inside the page/action instead.
//
// Per-role page access. First match wins, so MORE-SPECIFIC prefixes come first.
// Routes NOT listed here are open to ANY authenticated user (currently: "/" =
// reports/items, "/items", "/dashboard", "/files"). Whether /dashboard and
// /files should also be role-restricted is still open — confirm.
export const ROLE_PROTECTED: ReadonlyArray<{
  prefix: string;
  any: readonly AppRole[];
}> = [
  // User-management API — manager only (defense-in-depth; the handlers also
  // self-gate with withAuth). Listed first so it matches before anything else.
  { prefix: "/api/users", any: ["manager"] },
  // Settings — specific pages are manager-only, the rest are open to all roles.
  { prefix: "/settings/users", any: ["manager"] }, // user management — manager only
  { prefix: "/settings/customers", any: ["manager"] }, // customer code — manager only
  { prefix: "/settings", any: ["manager", "tester", "storekeeper"] }, // other settings — all roles
  // Main sections — each role reaches its own area.
  { prefix: "/testing", any: ["manager", "tester"] }, // testing — not storekeeper
  { prefix: "/shipments", any: ["manager", "storekeeper"] }, // shipments — not tester
  { prefix: "/dashboard", any: ["manager"] }, // analytics dashboard — manager only
  // "/files" and "/" (reports/items) stay open to any authenticated user.
];

export type AccessVerdict =
  | { kind: "public" }
  | { kind: "needs-auth" }
  | { kind: "allowed" }
  | { kind: "forbidden"; required: readonly AppRole[] };

/**
 * Resolve access for a (pathname, roles) pair. Used by middleware AND by server
 * components that mirror the same decision.
 * @param pathname Already normalized — basePath stripped.
 * @param roles    The user's roles. Pass null for anonymous (no session).
 */
export function resolveAccess(
  pathname: string,
  roles: string[] | null,
): AccessVerdict {
  if (
    PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return { kind: "public" };
  }
  if (!roles) return { kind: "needs-auth" };

  for (const rule of ROLE_PROTECTED) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + "/")) {
      if (hasAnyRole(roles, rule.any)) return { kind: "allowed" };
      return { kind: "forbidden", required: rule.any };
    }
  }
  return { kind: "allowed" };
}
