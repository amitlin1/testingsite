// SERVER-ONLY Keycloak Admin REST client. Authenticated via the
// `testing-admin-api` service account (client_credentials grant with
// realm-management roles manage-users/view-users/query-users).
//
// NEVER import this into a client component — it holds the admin secret and
// talks straight to Keycloak's admin API. Used by the /api/users/* route
// handlers (manager-gated) and by /api/workers-directory (any authenticated
// user — read-only identity lookups only, no mutation exposed there).

import { APP_ROLES, type AppRole } from "@/lib/auth/roles";

// Every call from this module is a BACK-CHANNEL call (server -> Keycloak), so it
// uses the INTERNAL issuer when one is configured. On an air-gapped host reached
// by IP, the public URL is the host's LAN IP, which a container cannot connect
// back to (Windows Firewall drops inbound LAN traffic from the docker bridge) —
// the user-management page would hang and then fail. Falls back to the public
// issuer when KEYCLOAK_INTERNAL_ISSUER is unset. See auth.ts for the full note.
const ISSUER =
  process.env.KEYCLOAK_INTERNAL_ISSUER ?? process.env.AUTH_KEYCLOAK_ISSUER ?? "";
const CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID ?? "testing-admin-api";
const CLIENT_SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET ?? "";

// issuer = {server}/realms/{realm}  →  admin base = {server}/admin/realms/{realm}
const REALM = ISSUER.split("/realms/")[1] ?? "";
const SERVER = ISSUER.replace(/\/realms\/[^/]+$/, "");
const ADMIN_BASE = `${SERVER}/admin/realms/${REALM}`;
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

// ---- service-account token (cached in-process until ~10s before expiry) ----
let cachedToken: { value: string; expiresAt: number } | null = null;
let inFlightToken: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`keycloak admin token failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 10_000) return cachedToken.value;
  // Single-flight: concurrent callers share ONE token request instead of each
  // hitting the token endpoint.
  if (!inFlightToken) {
    inFlightToken = fetchToken().finally(() => {
      inFlightToken = null;
    });
  }
  return inFlightToken;
}

async function kc(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  // A cached token can go stale — expired, or the service account's roles changed
  // (e.g. a new realm-management role was granted). On an auth failure, drop the
  // cached token and retry ONCE with a freshly-minted one.
  if ((res.status === 401 || res.status === 403) && !retried) {
    // Only invalidate the token that just failed — don't clobber a token that
    // another concurrent request may already have refreshed.
    if (cachedToken?.value === token) cachedToken = null;
    return kc(path, init, true);
  }
  return res;
}

/** Run `fn` over `items` with bounded concurrency (order-preserving results). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---- raw Keycloak shapes ----
interface KcUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled: boolean;
  createdTimestamp?: number;
  requiredActions?: string[];
  attributes?: Record<string, string[]>;
}
interface KcRole {
  id: string;
  name: string;
}

// ---- app-facing shapes ----
export type UserStatus = "active" | "disabled" | "locked" | "pending";
export interface AdminUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  fullName: string;
  employeeNumber: string | null;
  enabled: boolean;
  createdTimestamp: number | null;
  role: AppRole | null;
  status: UserStatus;
}

export interface CreateUserInput {
  username: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string;
  role: AppRole;
  temporaryPassword: string;
  mustChangePassword: boolean;
}

const isAppRole = (name: string): name is AppRole =>
  (APP_ROLES as readonly string[]).includes(name);

// ---- low-level ops ----
async function listUsers(search?: string): Promise<KcUser[]> {
  // Page through /users (Keycloak caps a single page); stop on a short page.
  const PAGE = 100;
  const all: KcUser[] = [];
  for (let first = 0; ; first += PAGE) {
    const q = new URLSearchParams({
      first: String(first),
      max: String(PAGE),
      briefRepresentation: "false",
    });
    if (search) q.set("search", search);
    const res = await kc(`/users?${q.toString()}`);
    if (!res.ok) throw new Error(`listUsers ${res.status}`);
    const page = (await res.json()) as KcUser[];
    all.push(...page);
    if (page.length < PAGE || all.length >= 5000 /* hard safety cap */) break;
  }
  return all;
}

/** Single user, or null if Keycloak doesn't return one. */
async function getUser(id: string): Promise<KcUser | null> {
  const res = await kc(`/users/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as KcUser;
}

/**
 * Users holding realm role `role`, straight from Keycloak — ONE paged call
 * instead of listing every user and asking for each one's role mappings.
 * Direct assignments only, which matches how setSingleAppRole grants them.
 */
async function listRoleMembers(role: AppRole): Promise<KcUser[]> {
  const PAGE = 100;
  const all: KcUser[] = [];
  for (let first = 0; ; first += PAGE) {
    const q = new URLSearchParams({ first: String(first), max: String(PAGE) });
    const res = await kc(`/roles/${encodeURIComponent(role)}/users?${q.toString()}`);
    if (!res.ok) throw new AdminError(`roleMembers ${role} ${res.status}`, res.status);
    const page = (await res.json()) as KcUser[];
    all.push(...page);
    if (page.length < PAGE || all.length >= 5000 /* hard safety cap */) break;
  }
  return all;
}

/** Exact-username lookup. "" when no such user. */
async function findUserIdByUsername(username: string): Promise<string> {
  const q = new URLSearchParams({ username, exact: "true", max: "1" });
  const res = await kc(`/users?${q.toString()}`);
  if (!res.ok) return "";
  const [u] = (await res.json()) as KcUser[];
  return u?.id ?? "";
}

async function getUserRealmRoles(id: string): Promise<KcRole[]> {
  const res = await kc(`/users/${id}/role-mappings/realm`);
  if (!res.ok) return [];
  return (await res.json()) as KcRole[];
}

async function getBruteForceStatus(id: string): Promise<{ disabled: boolean }> {
  const res = await kc(`/attack-detection/brute-force/users/${id}`);
  if (!res.ok) return { disabled: false };
  return (await res.json()) as { disabled: boolean };
}

async function getRealmRole(name: string): Promise<KcRole> {
  const res = await kc(`/roles/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`getRealmRole ${name} ${res.status}`);
  return (await res.json()) as KcRole;
}

/** Ensure the user holds exactly ONE app role (manager|tester|storekeeper|mashan). */
async function setSingleAppRole(id: string, role: AppRole): Promise<void> {
  const current = await getUserRealmRoles(id);
  const stale = current.filter((r) => isAppRole(r.name) && r.name !== role);
  if (stale.length) {
    const del = await kc(`/users/${id}/role-mappings/realm`, {
      method: "DELETE",
      body: JSON.stringify(stale.map((r) => ({ id: r.id, name: r.name }))),
    });
    // Don't let a failed role REVOCATION pass silently — a demotion that only
    // adds the new role but keeps the old one is a real authorization bug.
    if (!del.ok) throw new AdminError(`removeRoles ${del.status}`, del.status);
  }
  if (!current.some((r) => r.name === role)) {
    const r = await getRealmRole(role);
    const add = await kc(`/users/${id}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([{ id: r.id, name: r.name }]),
    });
    if (!add.ok) throw new AdminError(`addRole ${add.status}`, add.status);
  }
}

// ---- public API used by the route handlers ----

/** All managed users (human accounts) shaped for the admin table. Excludes
 *  Keycloak service-account users. */
export async function getAdminUsers(search?: string): Promise<AdminUser[]> {
  const users = (await listUsers(search)).filter(
    (u) => !u.username?.startsWith("service-account-"),
  );
  // Per-user role + brute-force lookups run with bounded concurrency (8) instead
  // of one-at-a-time — turns ~2N serial round-trips into ~2N/8.
  const out = await mapLimit(users, 8, async (u): Promise<AdminUser> => {
    const [roles, brute] = await Promise.all([
      getUserRealmRoles(u.id),
      u.enabled ? getBruteForceStatus(u.id) : Promise.resolve({ disabled: false }),
    ]);
    const role = (roles.find((r) => isAppRole(r.name))?.name ?? null) as AppRole | null;
    const pending = (u.requiredActions ?? []).includes("UPDATE_PASSWORD");
    const status: UserStatus = !u.enabled
      ? "disabled"
      : brute.disabled
        ? "locked"
        : pending
          ? "pending"
          : "active";
    const firstName = u.firstName ?? "";
    const lastName = u.lastName ?? "";
    return {
      id: u.id,
      username: u.username,
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" ") || u.username,
      employeeNumber: u.attributes?.employeeNumber?.[0] ?? null,
      enabled: u.enabled,
      createdTimestamp: u.createdTimestamp ?? null,
      role,
      status,
    };
  });
  // Newest first.
  out.sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0));
  return out;
}

/** True iff `userId` is the ONLY enabled user holding the manager role — used to
 *  block demote/disable/delete operations that would leave zero managers and
 *  lock everyone out of user management (unrecoverable in-app on an air-gapped
 *  network). */
export async function isLastEnabledManager(userId: string): Promise<boolean> {
  // Asks Keycloak for the manager role's members directly. getAdminUsers() would
  // answer this too, but at ~2 extra admin round-trips PER USER in the realm —
  // and PUT /api/users/[id] can need the answer twice in one request.
  const enabledManagers = (await listRoleMembers("manager")).filter(
    (u) => u.enabled && !u.username?.startsWith("service-account-"),
  );
  return enabledManagers.length === 1 && enabledManagers[0].id === userId;
}

/** Create a user + temporary password (+ optional forced change) + role, in the
 *  exact order the design specifies. Returns the new user id. */
export async function createManagedUser(input: CreateUserInput): Promise<string> {
  const attributes: Record<string, string[]> = {};
  if (input.employeeNumber) attributes.employeeNumber = [input.employeeNumber];
  const createRes = await kc(`/users`, {
    method: "POST",
    body: JSON.stringify({
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      attributes,
    }),
  });
  if (!createRes.ok) {
    if (createRes.status === 409) throw new AdminError("שם המשתמש כבר קיים", 409);
    // Log the real Keycloak reason server-side; return a generic message.
    console.error("createUser failed", createRes.status, await createRes.text().catch(() => ""));
    throw new AdminError("יצירת המשתמש נכשלה", createRes.status);
  }
  // Keycloak returns the new id in `location`. A reverse proxy can strip that
  // header — and an empty id would turn every follow-up into a request against
  // the COLLECTION (`/users/`), including the rollback DELETE. Fall back to an
  // exact-username lookup, and refuse to continue if even that fails.
  const id =
    (createRes.headers.get("location") ?? "").split("/").pop()?.trim() ||
    (await findUserIdByUsername(input.username));
  if (!id) {
    console.error("createUser: no id in location header and username lookup failed", input.username);
    throw new AdminError("המשתמש נוצר אך לא ניתן היה להשלים את ההגדרה. בדוק ב-Keycloak.", 502);
  }
  // Post-create steps. If any fails, ROLL BACK the half-created user so a
  // role-less / password-less orphan isn't left behind.
  try {
    await resetPassword(id, input.temporaryPassword, input.mustChangePassword);
    await setSingleAppRole(id, input.role);
  } catch (e) {
    await deleteUser(id).catch(() => {});
    throw e;
  }
  return id;
}

export async function updateUserProfile(
  id: string,
  patch: { firstName?: string; lastName?: string; employeeNumber?: string | null },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.firstName !== undefined) body.firstName = patch.firstName;
  if (patch.lastName !== undefined) body.lastName = patch.lastName;
  if (patch.employeeNumber !== undefined) {
    // Keycloak REPLACES the whole attribute map on PUT, so a bare
    // `{ employeeNumber: [...] }` (or `{}` when clearing) would silently wipe
    // locale, phone and every other attribute. Read-merge-write instead.
    const current = await getUser(id);
    const attributes = { ...(current?.attributes ?? {}) };
    if (patch.employeeNumber) attributes.employeeNumber = [patch.employeeNumber];
    else delete attributes.employeeNumber;
    body.attributes = attributes;
  }
  const res = await kc(`/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) throw new AdminError(`updateUser ${res.status}`, res.status);
}

export async function setUserRole(id: string, role: AppRole): Promise<void> {
  await setSingleAppRole(id, role);
}

export async function setUserEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await kc(`/users/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) });
  if (!res.ok) throw new AdminError(`setEnabled ${res.status}`, res.status);
  // Re-enabling should also clear a brute-force lock so the user can log in.
  if (enabled) await kc(`/attack-detection/brute-force/users/${id}`, { method: "DELETE" });
}

export async function resetPassword(id: string, password: string, temporary: boolean): Promise<void> {
  const res = await kc(`/users/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: password, temporary }),
  });
  if (!res.ok) throw new AdminError(`resetPassword ${res.status}`, res.status);
  // A temporary reset must force a change at next login. requiredActions is
  // REPLACED by a PUT, so merge into whatever is already pending — dropping a
  // UPDATE_PROFILE / VERIFY_EMAIL / CONFIGURE_TOTP here would let the user into
  // the app without ever completing it.
  if (temporary) {
    const current = await getUser(id);
    const pending = current?.requiredActions ?? [];
    const requiredActions = pending.includes("UPDATE_PASSWORD")
      ? pending
      : [...pending, "UPDATE_PASSWORD"];
    await kc(`/users/${id}`, { method: "PUT", body: JSON.stringify({ requiredActions }) });
  }
}

export async function deleteUser(id: string): Promise<void> {
  const res = await kc(`/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new AdminError(`deleteUser ${res.status}`, res.status);
}

/** Username of a single user (used for the self-action guard). "" if not found. */
export async function getUsername(id: string): Promise<string> {
  return (await getUser(id))?.username ?? "";
}

// ---- worker directory (any authenticated user — see /api/workers-directory) ----

/** Shape for "pick a person" UI (shipment attribution, testing-station roster).
 *  Replaces the old local `workers` table: `worker_id` is the Keycloak
 *  employeeNumber, `worker_name` the display name, `roles` the realm roles. */
export interface DirectoryWorker {
  worker_id: number;
  worker_name: string;
  roles: string[];
}

/** Enabled users with a valid numeric employeeNumber, shaped for a picker.
 *  Users without one are excluded — there's no id to attribute them by. No
 *  brute-force lookup here (unlike getAdminUsers) since a picker doesn't need
 *  lock status, just identity — keeps this to one round-trip per user instead
 *  of two. */
export async function getWorkersDirectory(): Promise<DirectoryWorker[]> {
  const users = (await listUsers()).filter(
    (u) => u.enabled && !u.username?.startsWith("service-account-"),
  );
  const out = await mapLimit(users, 8, async (u): Promise<DirectoryWorker | null> => {
    const empNo = u.attributes?.employeeNumber?.[0];
    const workerId = empNo ? Number(empNo) : NaN;
    if (!Number.isFinite(workerId) || workerId <= 0) return null;
    const roles = await getUserRealmRoles(u.id);
    const firstName = u.firstName ?? "";
    const lastName = u.lastName ?? "";
    return {
      worker_id: workerId,
      worker_name: [firstName, lastName].filter(Boolean).join(" ") || u.username,
      roles: roles.map((r) => r.name),
    };
  });
  return out
    .filter((w): w is DirectoryWorker => w !== null)
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name, "he"));
}

/** Typed error carrying an HTTP status so route handlers map it to a response. */
export class AdminError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}
