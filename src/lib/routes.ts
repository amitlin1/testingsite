// Route protection map — single source of truth for the middleware.
//
// A ROLE_PROTECTED entry matches its path and every path under it; a public
// route says for itself whether it opens the paths under it. Pages and menus
// import these to mirror the same decision (canSeeInNav, the users page's role
// panel).

import { ACCESS, can, type Permission } from "@/lib/auth/roles";

// Routes that don't require a session. /login and /no-auth MUST stay here, or
// the middleware redirects them to themselves — an infinite loop.
//
// The /api/* entries below are SERVER-TO-SERVER endpoints called with no browser
// session cookie, so the session middleware must let them through; each one
// authenticates ITSELF:
//   - /api/cron                → cronSecretGuard() (CRON_SECRET shared secret;
//                                CLOSED with 503 when the variable is unset)
//   - /api/onlyoffice/callback → verifies the OnlyOffice-signed JWT internally
//   - /api/files/download      → fetched by the (cookieless) OnlyOffice doc server;
//                                the route itself takes a signed token or an app
//                                session (hasAppSession)
// Those three open every path under them (`under: true`); every other entry is
// exactly its own path, so a route added beside one (/api/health/jobs) is gated
// like any other.
export const PUBLIC_ROUTES: ReadonlyArray<{ path: string; under?: true }> = [
  { path: "/no-auth" },
  { path: "/login" },
  { path: "/auth-error" }, // self-healing Auth.js error handler (must bypass the auth gate)
  // Container liveness probe. MUST stay public: the docker healthcheck and the
  // nginx upstream have no session cookie, and a gated probe answers 401 →
  // container marked unhealthy → nginx never starts. Leaks nothing (status +
  // uptime only, no DB/Keycloak access).
  { path: "/api/health" },
  // The metrics-schema version, read server-to-server with no session (plan §8
  // stage 2 / §10.2). Leaks only a schema number.
  { path: "/api/health/schema" },
  // RP-initiated logout initiator. MUST stay public: the caller has already
  // cleared its local session with signOut() before landing here, so a gated
  // route would bounce it to /login and leave the Keycloak SSO cookie alive.
  // Builds a redirect URL only — no DB, no secrets.
  { path: "/api/logout" },
  { path: "/api/cron", under: true },
  { path: "/api/onlyoffice/callback", under: true },
  { path: "/api/files/download", under: true },
];

const isPublic = (pathname: string): boolean =>
  PUBLIC_ROUTES.some((r) => pathname === r.path || (r.under === true && pathname.startsWith(r.path + "/")));

// Path-prefix → the permission it needs (can(), roles.ts). First match wins, so the
// more specific prefixes come first where they overlap. Routes NOT listed here
// are open to ANY authenticated user (currently "/", "/items", "/packages").
// Anything gated by DB state rather than a Keycloak role should NOT live here —
// let any authed user through the middleware and gate inside the page/action.
export const ROLE_PROTECTED: ReadonlyArray<{
  prefix: string;
  perm: Permission;
}> = [
  // User-management API — manager only (defense-in-depth; the handlers also
  // self-gate with withAuth). Listed first so it matches before anything else.
  { prefix: "/api/users", perm: ACCESS.usersAdmin },
  // Dashboard/analytics API — manager only, mirroring the /dashboard page rule
  // below. Until 2026-08 these 21 endpoints were reachable by ANY authenticated
  // session (the gate was on /dashboard only), exposing all customer analytics
  // to tester/storekeeper roles. Handlers also self-gate with withAuth.
  { prefix: "/api/dashboard", perm: ACCESS.dashboard },
  // Testing API — the same roles as the /testing page below. Without it a
  // storekeeper, kept off the page, could still start a test or post a result
  // by calling these directly. Every caller is the testing page and its
  // wizards (plus the manager-only dashboard's station list).
  { prefix: "/api/testing", perm: ACCESS.testing },
  // Box intake from its shipment — the shipments screen's roles.
  // Its undo, /api/packages/<id>/intake, can't be matched by prefix; both
  // handlers self-gate with withAuth.
  { prefix: "/api/packages/intake", perm: ACCESS.intake },
  // Work-hours API — admin + timekeeper (משאן). Handlers also self-gate with withAuth.
  { prefix: "/api/settings/work-hours", perm: ACCESS.workHours },
  // Sources — not the tester's. Only the sources settings page reads this API.
  { prefix: "/api/settings/sources", perm: ACCESS.sourcesSettings },
  // Settings pages — one rule per page, each naming who may open it. Pages
  // only: the intake and the queues still read routes / stations / statuses
  // through /api/settings/* (see the role plan).
  { prefix: "/settings/users", perm: ACCESS.usersAdmin },
  { prefix: "/settings/customers", perm: ACCESS.customersSettings },
  { prefix: "/settings/item-types", perm: ACCESS.itemTypesSettings },
  { prefix: "/settings/packages", perm: ACCESS.packagesSettings },
  { prefix: "/settings/sources", perm: ACCESS.sourcesSettings },
  { prefix: "/settings/item-status", perm: ACCESS.itemStatusSettings },
  { prefix: "/settings/test-station-status", perm: ACCESS.testStationStatusSettings },
  { prefix: "/settings/test-stations", perm: ACCESS.testStationsSettings },
  { prefix: "/settings/testing-routes", perm: ACCESS.fieldsEdit },
  { prefix: "/settings/popup-templates", perm: ACCESS.popupTemplatesSettings },
  { prefix: "/settings/reference-items", perm: ACCESS.referenceItemsSettings },
  { prefix: "/settings/work-hours", perm: ACCESS.workHours },
  // Any settings page not listed above — manager only until it gets its own rule.
  { prefix: "/settings", perm: ACCESS.otherSettings },
  // Main sections — each role reaches its own area.
  { prefix: "/testing", perm: ACCESS.testing },
  { prefix: "/shipments", perm: ACCESS.shipments },
  { prefix: "/dashboard", perm: ACCESS.dashboard },
  { prefix: "/files", perm: ACCESS.files },
  // "/" and "/packages" (מארזים ופריטים) stay open to any authenticated user.
];

export type AccessVerdict =
  | { kind: "public" }
  | { kind: "needs-auth" }
  | { kind: "allowed" }
  | { kind: "forbidden"; required: Permission };

/**
 * A data request (XHR / API fetch: answer JSON 401/403), not a navigation (answer a redirect).
 * @param pathname Already normalized — basePath stripped.
 */
export function isDataRequest(pathname: string, headers: Headers): boolean {
  if (pathname.startsWith("/api/")) return true;

  // Client-side <Link>/router navigations send an RSC fetch carrying the `rsc`
  // header but NOT sec-fetch-mode:navigate and NOT Accept:text/html. Treat them
  // as navigations so they get a proper redirect (which the App Router turns
  // into a hard navigation) — a JSON 401 would freeze the UI.
  if (headers.has("rsc")) return false;

  if ((headers.get("sec-fetch-mode") ?? "") === "navigate") return false;
  if ((headers.get("accept") ?? "").includes("text/html")) return false;
  return true;
}

/**
 * Should this route appear in a NAVIGATION menu for these roles?
 *
 * Differs from resolveAccess in exactly one case: roles === null, i.e. the
 * client session hasn't resolved yet. resolveAccess calls that "needs-auth"
 * (not "forbidden"), so a `.kind !== "forbidden"` filter renders EVERY link
 * during the loading window. Two visible consequences:
 *   - Next prefetches those links, and the ones the user may not open answer
 *     403 — console noise on every full page load for non-manager roles.
 *   - The user briefly sees menu entries that vanish once the session lands.
 *
 * Treating "identity unknown" as "no roles" shows only the entries that need no
 * role at all, then fills in. Never shows more than the user is allowed.
 *
 * (Hydrating the session on the server would remove the window entirely, but
 * SessionProvider must not be given a `session` prop — see app/providers.tsx.)
 */
export function canSeeInNav(pathname: string, roles: string[] | null): boolean {
  return resolveAccess(pathname, roles ?? []).kind !== "forbidden";
}

/**
 * Resolve access for a (pathname, roles) pair. Used by middleware AND by the
 * screens that mirror the same decision.
 * @param pathname Already normalized — basePath stripped.
 * @param roles    The user's roles. Pass null for anonymous (no session).
 */
export function resolveAccess(
  pathname: string,
  roles: string[] | null,
): AccessVerdict {
  if (isPublic(pathname)) return { kind: "public" };
  if (!roles) return { kind: "needs-auth" };

  const perm = permissionForPath(pathname);
  if (!perm || can(roles, perm)) return { kind: "allowed" };
  return { kind: "forbidden", required: perm };
}

/** The permission a path needs — its ROLE_PROTECTED rule's; null when any signed-in user may open it.
 *  @param pathname Already normalized — basePath stripped. */
export function permissionForPath(pathname: string): Permission | null {
  const rule = ROLE_PROTECTED.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  return rule?.perm ?? null;
}
