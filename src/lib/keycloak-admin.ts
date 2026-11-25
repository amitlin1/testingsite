// SERVER-ONLY Keycloak Admin REST client. Authenticated via the
// `testing-admin-api` service account (client_credentials grant with
// realm-management roles manage-users/view-users/query-users).
//
// NEVER import this into a client component — it holds the admin secret and
// talks straight to Keycloak's admin API. Used by the /api/users/* route
// handlers (manager-gated), and for read-only identity lookups (no mutation) by
// /api/workers-directory (any authenticated user) and by the item / package
// reads and the item report, which name the workers on them.

import { NextResponse } from "next/server";
import { ADMIN_ROLE, isAppRole, type AppRole } from "@/lib/auth/roles";
import { workerIdOf } from "@/lib/auth/identity";
import { adminApiBase, adminClient, internalIssuer } from "@/lib/auth/keycloak-env";
import { HttpError, errorResponse } from "@/lib/http/errors";
import { mapWithConcurrency } from "@/lib/async";
import {
  fullNameOf,
  isServiceAccount,
  type AdminUser,
  type CreateUserInput,
  type DirectoryWorker,
  type UserStatus,
} from "@/lib/users/rules";

// Every call from this module is a BACK-CHANNEL call (server -> Keycloak), so it
// uses the INTERNAL issuer when one is configured. On an air-gapped host reached
// by IP, the public URL is the host's LAN IP, which a container cannot connect
// back to (Windows Firewall drops inbound LAN traffic from the docker bridge) —
// the user-management page would hang and then fail. Falls back to the public
// issuer when KEYCLOAK_INTERNAL_ISSUER is unset. See auth.ts for the full note.
const ISSUER = internalIssuer() ?? "";
const { id: CLIENT_ID, secret: CLIENT_SECRET } = adminClient();
const ADMIN_BASE = adminApiBase(ISSUER);
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
  if (!res.ok) throw failed("token", res, await res.text().catch(() => ""));
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

// ---- failures ----
// Keycloak answering anything but success is a gateway failure: logged with what it said, and
// answered 502 with the route's own Hebrew text (adminErrorResponse) — never its status or words,
// which would read as this app's (a 401 passed through would look like an expired session).
// The refusals a manager should read are HttpErrors in Hebrew.

function failed(op: string, res: Response, detail = ""): Error {
  return new Error(`keycloak admin ${op}: ${res.status}${detail ? ` ${detail}` : ""}`);
}

/** How the users API and the workers directory answer a failure: a refusal (HttpError) as itself;
 *  anything else is logged and answered 502 with `fallback` — these routes stand in front of
 *  Keycloak, so its failure is a gateway's. */
export function adminErrorResponse(e: unknown, fallback: string): Response {
  if (e instanceof HttpError) return errorResponse(e, fallback);
  console.error(fallback, e);
  return NextResponse.json({ error: fallback }, { status: 502 });
}

// ---- low-level ops ----

/** Every page of a Keycloak list (it caps a single page): stops on a short page, or at a hard
 *  safety cap of 5000 rows. */
async function listAll<T>(op: string, path: string, params: Record<string, string> = {}): Promise<T[]> {
  const PAGE = 100;
  const all: T[] = [];
  for (let first = 0; ; first += PAGE) {
    const q = new URLSearchParams({ first: String(first), max: String(PAGE), ...params });
    const res = await kc(`${path}?${q.toString()}`);
    if (!res.ok) throw failed(op, res);
    const page = (await res.json()) as T[];
    all.push(...page);
    if (page.length < PAGE || all.length >= 5000) break;
  }
  return all;
}

function listUsers(search?: string): Promise<KcUser[]> {
  return listAll<KcUser>("listUsers", "/users", { briefRepresentation: "false", ...(search ? { search } : {}) });
}

async function getUser(id: string): Promise<KcUser | null> {
  const res = await kc(`/users/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as KcUser;
}

/**
 * Users holding realm role `role`, straight from Keycloak — ONE paged call
 * instead of listing every user and asking for each one's role mappings.
 * Direct assignments only, which matches how setUserRole grants them.
 */
function listRoleMembers(role: AppRole): Promise<KcUser[]> {
  return listAll<KcUser>(`roleMembers ${role}`, `/roles/${encodeURIComponent(role)}/users`);
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
  if (!res.ok) throw failed(`getRealmRole ${name}`, res);
  return (await res.json()) as KcRole;
}

/**
 * Ensure the user holds exactly ONE app role (manager|tester|storekeeper|mashan).
 *
 * Order matters: the new role is resolved and granted BEFORE the old one is
 * revoked. Revoking first left a user with no role at all whenever the grant
 * then failed (a realm without the role, Keycloak down) — the change reported
 * an error yet had already taken effect. Now a failure before the grant
 * changes nothing; a failed revoke still throws (a demotion that keeps the old
 * role is a real authorization bug), leaving both roles for a retry to fix.
 */
export async function setUserRole(id: string, role: AppRole): Promise<void> {
  const current = await getUserRealmRoles(id);
  if (!current.some((r) => r.name === role)) {
    let target: KcRole;
    try {
      target = await getRealmRole(role);
    } catch {
      throw new HttpError(409, `התפקיד "${role}" לא מוגדר ב-Keycloak — יש ליצור אותו ב-Realm roles. לא בוצע שינוי.`);
    }
    const add = await kc(`/users/${id}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([{ id: target.id, name: target.name }]),
    });
    if (!add.ok) throw failed("addRole", add);
  }
  const stale = current.filter((r) => isAppRole(r.name) && r.name !== role);
  if (stale.length) {
    const del = await kc(`/users/${id}/role-mappings/realm`, {
      method: "DELETE",
      body: JSON.stringify(stale.map((r) => ({ id: r.id, name: r.name }))),
    });
    if (!del.ok) throw failed("removeRoles", del);
  }
}

// ---- public API used by the route handlers ----

/** All managed users (human accounts) shaped for the admin table. Excludes
 *  Keycloak service-account users. */
export async function getAdminUsers(search?: string): Promise<AdminUser[]> {
  const users = (await listUsers(search)).filter((u) => !isServiceAccount(u.username));
  // Per-user role + brute-force lookups run with bounded concurrency (8) instead
  // of one-at-a-time — turns ~2N serial round-trips into ~2N/8.
  const out = await mapWithConcurrency(users, 8, async (u): Promise<AdminUser> => {
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
    return {
      id: u.id,
      username: u.username,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      fullName: fullNameOf(u),
      employeeNumber: u.attributes?.employeeNumber?.[0] ?? null,
      enabled: u.enabled,
      createdTimestamp: u.createdTimestamp ?? null,
      role,
      status,
    };
  });
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
  const enabledManagers = (await listRoleMembers(ADMIN_ROLE)).filter(
    (u) => u.enabled && !isServiceAccount(u.username),
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
    if (createRes.status === 409) throw new HttpError(409, "שם המשתמש כבר קיים");
    throw failed("createUser", createRes, await createRes.text().catch(() => ""));
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
    throw new HttpError(502, "המשתמש נוצר אך לא ניתן היה להשלים את ההגדרה. בדוק ב-Keycloak.");
  }
  // Post-create steps. If any fails, ROLL BACK the half-created user so a
  // role-less / password-less orphan isn't left behind.
  try {
    await resetPassword(id, input.temporaryPassword, input.mustChangePassword);
    await setUserRole(id, input.role);
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
  if (!res.ok) throw failed("updateUser", res);
}

export async function setUserEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await kc(`/users/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) });
  if (!res.ok) throw failed("setEnabled", res);
  // Re-enabling should also clear a brute-force lock so the user can log in.
  if (enabled) await kc(`/attack-detection/brute-force/users/${id}`, { method: "DELETE" });
}

export async function resetPassword(id: string, password: string, temporary: boolean): Promise<void> {
  const res = await kc(`/users/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ type: "password", value: password, temporary }),
  });
  if (!res.ok) throw failed("resetPassword", res);
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
  if (!res.ok) throw failed("deleteUser", res);
}

/** "" when Keycloak returns no such user. */
export async function getUsername(id: string): Promise<string> {
  return (await getUser(id))?.username ?? "";
}

// ---- worker directory (any authenticated user — see /api/workers-directory) ----

/** Enabled users with a valid numeric employeeNumber, shaped for a picker.
 *  Users without one are excluded — there's no id to attribute them by. No
 *  brute-force lookup here (unlike getAdminUsers) since a picker doesn't need
 *  lock status, just identity — keeps this to one round-trip per user instead
 *  of two. */
export async function getWorkersDirectory(): Promise<DirectoryWorker[]> {
  const users = (await listUsers()).filter((u) => u.enabled && !isServiceAccount(u.username));
  const out = await mapWithConcurrency(users, 8, async (u): Promise<DirectoryWorker | null> => {
    const workerId = workerIdOf(u.attributes?.employeeNumber?.[0]);
    if (workerId == null) return null;
    const roles = await getUserRealmRoles(u.id);
    return { worker_id: workerId, worker_name: fullNameOf(u), roles: roles.map((r) => r.name) };
  });
  return out
    .filter((w): w is DirectoryWorker => w !== null)
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name, "he"));
}
