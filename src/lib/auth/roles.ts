// App role names + type-safe helpers.
//
// Funneling every role check through hasRole/hasAnyRole makes stray string
// checks fail at compile time (the literal type narrows to AppRole).
//
// These are REALM roles in the `testing` Keycloak realm (realm_access.roles);
// auth.ts also merges client roles, so listing the final names here is enough
// regardless of where they're assigned. realm_access also carries noise
// (default-roles-testing, offline_access, uma_authorization) — only the names
// below carry meaning in this app.
export const APP_ROLES = ["manager", "tester", "storekeeper"] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** True if the role list contains the specific role. */
export function hasRole(roles: string[], role: AppRole): boolean {
  return roles.includes(role);
}

/** True if the user has at least one of the listed roles. */
export function hasAnyRole(
  roles: string[],
  required: readonly AppRole[],
): boolean {
  return required.some((r) => roles.includes(r));
}

/** "manager" is this app's admin role — it manages users and reaches the
 *  user-management page. Fine-grained per-role permissions are defined later. */
export function isAdmin(roles: string[]): boolean {
  return hasRole(roles, "manager");
}
