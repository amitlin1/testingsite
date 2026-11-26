// App roles, permissions, and who may do what (ACCESS).
//
// Two kinds of Keycloak REALM roles in the `testing` realm (realm_access.roles; auth.ts also merges
// client roles, so the names are enough wherever they are assigned):
//   - the MAIN role (manager, tester, storekeeper, mashan): one per user, what the users page shows.
//     In Keycloak each main role is a BUNDLE — a composite role holding its permissions — so whoever
//     gets it gets all of them;
//   - the PERMISSIONS, a pair each: perm-<name> grants it, no-<name> takes it away from one user
//     even though their bundle holds it (Keycloak cannot subtract from a composite, so a removal has
//     to be a role of its own).
// The table — names, labels, the default bundles — is permissions.json, which the migration script
// (scripts/ops/keycloak-permissions.mjs) reads too. realm_access also carries noise
// (default-roles-testing, offline_access, uma_authorization); only these names carry meaning here.
import table from "./permissions.json";

export type AppRole = keyof typeof table.mainRoles;

export const APP_ROLES = Object.keys(table.mainRoles) as AppRole[];

export const ROLE_LABEL: Record<AppRole, string> = table.mainRoles;

export function isAppRole(v: unknown): v is AppRole {
  return (APP_ROLES as readonly unknown[]).includes(v);
}

/** This app's admin role: it manages users, and the last enabled one cannot be removed. */
export const ADMIN_ROLE: AppRole = "manager";

export type PermissionKey = keyof typeof table.permissions;

/** One permission and its two Keycloak roles. */
export interface Permission {
  key: PermissionKey;
  /** The role that grants it (perm-…): in a main role's bundle, or assigned to a user directly. */
  role: string;
  /** The role that takes it away from one user (no-…). */
  deny: string;
  /** What the users page calls it. */
  label: string;
  /** The main roles whose bundle holds it by default (a fresh migration, and see can()). */
  bundles: readonly AppRole[];
}

const PERMISSION_KEYS = Object.keys(table.permissions) as PermissionKey[];

const permissionOf = (key: PermissionKey): Permission => {
  const p = table.permissions[key];
  return { key, role: table.grant + p.role, deny: table.deny + p.role, label: p.label, bundles: p.bundles as AppRole[] };
};

/** Every permission, in the table's order. */
export const PERMISSIONS: readonly Permission[] = PERMISSION_KEYS.map(permissionOf);

const BY_KEY = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p])) as Record<PermissionKey, Permission>;

export function isPermissionKey(v: unknown): v is PermissionKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(BY_KEY, v);
}

export const permissionByKey = (key: PermissionKey): Permission => BY_KEY[key];

/** A permission's grant role (perm-…). */
export const isGrantRole = (name: string): boolean => name.startsWith(table.grant);

/** A permission's deny role (no-…). */
export const isDenyRole = (name: string): boolean => name.startsWith(table.deny);

/** The permission a perm-… or no-… role belongs to; undefined for any other name. */
export function permissionOfRole(name: string): Permission | undefined {
  return PERMISSIONS.find((p) => p.role === name || p.deny === name);
}

/**
 * Who may do what. Every gate reads its permission here: the middleware's ROLE_PROTECTED
 * (src/lib/routes.ts), withAuth({ perm }) on the API, requirePermission, and the screens that hide
 * what the user may not do — always through can().
 */
export const ACCESS = {
  ...BY_KEY,
  /** Edit a route's report template — the same permission as its station fields. */
  reportTemplate: BY_KEY.fieldsEdit,
} as const satisfies Record<string, Permission>;

/**
 * May a user with these roles do it? Granted by its perm-… role (through the main role's bundle,
 * or directly), unless the user holds its no-… role.
 *
 * A token with no perm-… role at all comes from a realm the migration script has not run on yet
 * (or from dev mode / a test): there the main role answers by the default bundle, so the app works
 * exactly as it did before the move until the script runs. Once a realm has the bundles, every
 * user's token carries perm-… roles and this fallback never answers.
 */
export function can(roles: readonly string[] | null | undefined, p: Permission): boolean {
  const held = roles ?? [];
  if (held.includes(p.deny)) return false;
  if (held.some(isGrantRole)) return held.includes(p.role);
  return p.bundles.some((r) => held.includes(r));
}
