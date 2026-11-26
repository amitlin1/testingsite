// The app's people, as Keycloak holds them: the shapes the users API and the workers directory answer
// with, and the rules user administration enforces. Pure, so the screens read the same types the
// API (src/app/api/users, src/app/api/workers-directory) builds.
import { isAppRole, isPermissionKey, type AppRole, type PermissionKey } from "@/lib/auth/roles";

/** A row of GET /api/workers-directory: a person a "who did this" picker offers — an enabled user
 *  with a valid employee number. */
export interface DirectoryWorker {
  /** The employee number (מספר עובד) as a worker id (workerIdOf). */
  worker_id: number;
  /** fullNameOf the user. */
  worker_name: string;
  /** Keycloak realm roles, bundles opened (main role, perm-…, no-…). */
  roles: string[];
}

export type UserStatus = "active" | "disabled" | "locked" | "pending";

/** A managed account as GET /api/users lists it. */
export interface AdminUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  /** First and last name, else the username (fullNameOf). */
  fullName: string;
  employeeNumber: string | null;
  enabled: boolean;
  createdTimestamp: number | null;
  role: AppRole | null;
  /** Permissions taken away from this user alone (their no-… roles). */
  denied: PermissionKey[];
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

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,64}$/;
const EMPLOYEE_NUMBER_RE = /^\d{1,32}$/;
const EMPLOYEE_NUMBER_MAX = 32;
const NAME_MAX = 100;

/** The shortest password the API sets: a new user's temporary one, and a reset. */
export const MIN_PASSWORD_LENGTH = 6;

/** A Keycloak user id (a UUID), as the /api/users/[id] routes accept it. */
export function isUserId(id: string): boolean {
  return USER_ID_RE.test(id);
}

/** Keycloak's own service accounts ("service-account-<client>"): not people — never listed, never acted on. */
export function isServiceAccount(username: string | null | undefined): boolean {
  return !!username?.startsWith("service-account-");
}

/** `target` is the signed-in account itself (an unknown username is nobody). */
export function isSameAccount(target: string | null | undefined, signedIn: string | null | undefined): boolean {
  return !!target && target === signedIn;
}

/** The name the app shows for an account: first and last name, else the username. */
export function fullNameOf(u: { username: string; firstName?: string; lastName?: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username;
}

/** A name field as stored: trimmed, at most 100 characters; undefined when it is not a string. */
export function cleanName(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim().slice(0, NAME_MAX) : undefined;
}

/** An edit's employee number: undefined leaves it as is, an empty value clears it (null), anything
 *  else is stored trimmed to 32 characters. */
export function employeeNumberEdit(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  return v ? String(v).trim().slice(0, EMPLOYEE_NUMBER_MAX) : null;
}

/** POST /api/users's body as a new account, or null when a field breaks a rule. */
export function parseNewUser(body: Record<string, unknown> | null): CreateUserInput | null {
  const role = body?.role;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const temporaryPassword = typeof body?.temporaryPassword === "string" ? body.temporaryPassword : "";
  const employeeNumber = typeof body?.employeeNumber === "string" ? body.employeeNumber.trim() : "";
  if (
    !USERNAME_RE.test(username) ||
    temporaryPassword.length < MIN_PASSWORD_LENGTH ||
    !isAppRole(role) ||
    (employeeNumber !== "" && !EMPLOYEE_NUMBER_RE.test(employeeNumber))
  ) {
    return null;
  }
  return {
    username,
    firstName: cleanName(body?.firstName),
    lastName: cleanName(body?.lastName),
    employeeNumber: employeeNumber || undefined,
    role,
    temporaryPassword,
    mustChangePassword: body?.mustChangePassword !== false,
  };
}

/** Permissions no user can have taken away alone: user management (taking it from a manager could
 *  leave nobody able to manage users — the same lockout the last-manager guard prevents). To take
 *  it away, change the user's main role. */
export const UNDENIABLE: readonly PermissionKey[] = ["usersAdmin"];

/** PUT /api/users/[id]/permissions's body { denied: [key…] } → the keys, each once; null when it is
 *  not a list of permission keys or names one in UNDENIABLE. */
export function parseDenied(body: Record<string, unknown> | null): PermissionKey[] | null {
  const raw = body?.denied;
  if (!Array.isArray(raw) || !raw.every(isPermissionKey)) return null;
  const keys = [...new Set(raw)];
  return keys.some((k) => UNDENIABLE.includes(k)) ? null : keys;
}
