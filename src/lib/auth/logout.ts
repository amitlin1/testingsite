"use client";

// RP-Initiated logout — clears the local Auth.js session AND terminates the
// Keycloak session, so re-entering the app doesn't auto-sign-in with the still-
// valid SSO cookie. PORTABLE.
//
// The Keycloak issuer is NOT read here. It used to come from
// NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER, but `next build` inlines NEXT_PUBLIC_* into
// the static bundle, which pins the built image to one environment — fatal for
// an air-gapped tar that is built here and run in production. Instead we hand
// off to /api/logout, a route handler that reads AUTH_KEYCLOAK_ISSUER from the
// server env at request time. One image, any environment.

import { signOut } from "next-auth/react";
import { BASE_PATH, withBasePath } from "@/lib/base-path";

/**
 * Local signOut + redirect through /api/logout, which forwards to Keycloak's
 * RP-Initiated logout endpoint. `idToken` (from `session.idToken`) is passed as
 * `id_token_hint` so Keycloak terminates the right session without showing a
 * confirmation page.
 */
export async function fullLogout(idToken: string | undefined): Promise<void> {
  await signOut({ redirect: false });
  const params = new URLSearchParams();
  if (idToken) params.set("id_token_hint", idToken);
  // Land on the (public) login page after Keycloak ends the SSO session —
  // NOT the protected root, which would just bounce through the middleware.
  params.set("post_logout_redirect_uri", `${window.location.origin}${BASE_PATH}/login`);
  window.location.href = `${withBasePath("/api/logout")}?${params.toString()}`;
}
