// Where this deployment's Keycloak is, read from the server env. Server code only (auth.ts, the
// edge middleware through it, the admin client, /api/logout).
//
// AUTH_KEYCLOAK_ISSUER is the PUBLIC address; KEYCLOAK_INTERNAL_ISSUER, when set, is the address
// this process calls Keycloak on — see "SPLIT-HORIZON KEYCLOAK URLs" in auth.ts for why they differ.

/** The issuer for this process's own calls to Keycloak (the back channel): the internal one when
 *  set (an empty value counts as unset), else the public one. */
export function internalIssuer(): string | undefined {
  return process.env.KEYCLOAK_INTERNAL_ISSUER || process.env.AUTH_KEYCLOAK_ISSUER;
}

/** Client id, secret and issuer are all set, so the Keycloak provider can be configured. */
export function isKeycloakConfigured(): boolean {
  return !!process.env.AUTH_KEYCLOAK_ID && !!process.env.AUTH_KEYCLOAK_SECRET && !!process.env.AUTH_KEYCLOAK_ISSUER;
}

/** The admin REST API's service account (realm-management roles manage/view/query-users,
 *  view-realm, and manage-realm for the managers' role editor). */
export function adminClient(): { id: string; secret: string } {
  return {
    id: process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "testing-admin-api",
    secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? "",
  };
}

/** An issuer `{server}/realms/{realm}` → its admin API base `{server}/admin/realms/{realm}`. */
export function adminApiBase(issuer: string): string {
  const realm = issuer.split("/realms/")[1] ?? "";
  const server = issuer.replace(/\/realms\/[^/]+$/, "");
  return `${server}/admin/realms/${realm}`;
}
