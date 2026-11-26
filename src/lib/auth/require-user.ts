// Server-side auth guard for Server Actions (and Server Components). The app has
// no Server Actions today; the users settings layout is its one caller.
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
//   requirePermission() → requireUser() + a permission check (can()); redirects to /no-auth on a miss.
//
// READS vs MUTATIONS: use these in MUTATING actions (a click expects an effect →
// redirect on dead session). For READ-ONLY loaders, do NOT use requireUser —
// degrade to empty via getCurrentUser(), or an on-mount read causes redirect
// churn. Calling auth() inside getCurrentUser() is itself the silent-refresh
// trigger, so a merely-expired access token is refreshed with NO redirect.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser, type CurrentUser } from "./current-user";
import { can, type Permission } from "./roles";
import { SERVER_BASE_PATH, loginUrl, noAuthUrl } from "@/lib/base-path";

async function loginRedirectTarget(): Promise<string> {
  let callback = `${SERVER_BASE_PATH}/`;
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
  return loginUrl(callback);
}

/** Resolve the current user or redirect to login on a genuinely dead session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(await loginRedirectTarget());
  return user;
}

/** requireUser() + a permission gate. On a miss, redirects to /no-auth. For a
 *  soft "missing permission" message in an action, check can() inline and return a
 *  FORBIDDEN result instead of calling this. */
export async function requirePermission(perm: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.roles, perm)) {
    redirect(noAuthUrl());
  }
  return user;
}
