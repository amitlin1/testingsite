"use client";

// RP-Initiated logout — clears the local Auth.js session AND terminates the
// Keycloak session, so re-entering the app doesn't auto-sign-in with the still-
// valid SSO cookie. PORTABLE.
//
// The issuer is read client-side, so it needs a NEXT_PUBLIC_ mirror. Set
// NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER to our realm issuer (dev:
// http://localhost:8080/realms/testing).

import { signOut } from "next-auth/react";
import { BASE_PATH } from "@/lib/base-path";

const ISSUER =
  process.env.NEXT_PUBLIC_AUTH_KEYCLOAK_ISSUER ??
  "http://localhost:8080/realms/testing";

/**
 * Local signOut + redirect to Keycloak's RP-Initiated logout endpoint.
 * `idToken` (from `session.idToken`) is passed as `id_token_hint` so Keycloak
 * terminates the right session without a confirmation page.
 */
export async function fullLogout(idToken: string | undefined): Promise<void> {
  await signOut({ redirect: false });
  const params = new URLSearchParams();
  if (idToken) params.set("id_token_hint", idToken);
  // Land on the (public) login page after Keycloak ends the SSO session —
  // NOT the protected root, which would just bounce through the middleware.
  params.set("post_logout_redirect_uri", `${window.location.origin}${BASE_PATH}/login`);
  window.location.href = `${ISSUER}/protocol/openid-connect/logout?${params.toString()}`;
}
