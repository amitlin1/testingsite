// Server-side auth guard for Server Actions (and Server Components). PORTABLE.
//
// WHY THIS EXISTS (the Server-Action redirect gap):
//   A Server Action POST cannot be redirected by middleware — Next swallows a
//   middleware 3xx on the action's internal fetch, and a bare 401 throws inside
//   the action client (silent UI failure). The ONLY mechanism that becomes a
//   real navigation for an action is redirect() called INSIDE the action: Next
//   encodes it as the x-action-redirect response header. So the dead-session
//   redirect for MUTATIONS must originate here, server-side.
//
// CONTRACT:
//   requireUser()  → returns CurrentUser, or REDIRECTS to /login on a genuinely
//                    dead session (getCurrentUser() returns null — no session or
//                    terminal RefreshAccessTokenError). The user's id (if the
//                    app resolves one) may be null = authenticated-but-no-local-
//                    row; that is NOT a dead session — the caller decides.
//   requireRole()  → requireUser() + role check; redirects to /no-auth on a miss.
//
// READS vs MUTATIONS: use these in MUTATING actions (a click expects an effect →
// redirect on dead session). For READ-ONLY loaders, do NOT use requireUser —
// degrade to empty via getCurrentUser(), or an on-mount read causes redirect
// churn. Calling auth() inside getCurrentUser() is itself the silent-refresh
// trigger, so a merely-expired access token is refreshed with NO redirect.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { hasAnyRole, type AppRole } from "./roles";
import { normalizeBasePath } from "@/lib/base-path";

const BASE_PATH = normalizeBasePath(process.env.NEXT_BASE_PATH);

async function loginRedirectTarget(): Promise<string> {
  let callback = `${BASE_PATH}/`;
  try {
    const referer = (await headers()).get("referer");
    if (referer) {
      const u = new URL(referer);
      const path = u.pathname + u.search;
      if (path.startsWith("/")) callback = path;
    }
  } catch {
    // headers() unavailable in this context — fall back to the root.
  }
  return `${BASE_PATH}/login?callbackUrl=${encodeURIComponent(callback)}`;
}

/** Resolve the current user or redirect to login on a genuinely dead session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    // In dev there's no Keycloak; a null user just means no dev user picked yet.
    // Sending them to the Keycloak-only /login would 500, so bounce to root.
    if (process.env.IS_DEV === "1") {
      redirect(`${BASE_PATH}/`);
    }
    redirect(await loginRedirectTarget());
  }
  return user;
}

/** requireUser() + a role gate. On a role miss, redirects to /no-auth. For a
 *  soft "missing role" message in an action, check the role inline and return a
 *  FORBIDDEN result instead of calling this. */
export async function requireRole(
  roles: AppRole | AppRole[],
): Promise<CurrentUser> {
  const user = await requireUser();
  const required = Array.isArray(roles) ? roles : [roles];
  if (!hasAnyRole(user.roles, required)) {
    redirect(`${BASE_PATH}/no-auth`);
  }
  return user;
}
