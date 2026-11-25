import type { Session } from "next-auth";

/** Who is signed in, as the app shows and stores them. Pure; client and server. */
export type Identity = {
  /** Keycloak preferred_username ("" when the token has none). */
  username: string;
  /** The display name, else the name, else the username: the first that is not empty ("" when none is). */
  displayName: string;
  /** מספר עובד as on the token (null when unset). */
  employeeNumber: string | null;
  /** The employee number as a worker id (see workerIdOf). */
  workerId: number | null;
};

/** Who writes: username → *_by columns; name → the display-name snapshot kept beside it. Null, not
 *  "", when the token has none: the columns store SQL NULL. */
export type Actor = { username: string | null; name: string | null };

/** An employee number as a worker id: a positive number, else null (unset, "", "abc", "0", "-3"). */
export function workerIdOf(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function identityOf(session: Session | null | undefined): Identity {
  const u = session?.user;
  const username = u?.preferredUsername ?? "";
  const employeeNumber = u?.employeeNumber ?? null;
  return {
    username,
    displayName: u?.displayName || u?.name || username,
    employeeNumber,
    workerId: workerIdOf(employeeNumber),
  };
}

/** The actor of a signed-in request. */
export function actorFromSession(session: Session): Actor {
  const { username, displayName } = identityOf(session);
  return { username: username || null, name: displayName || null };
}
