import { currentSession } from "@/lib/auth/current-session";
import { isLiveSession } from "./session";

/**
 * True when the current request carries a valid (non-terminal) app session.
 * Any authenticated user passes (no role restriction).
 *
 * The file-serving route handlers check it themselves: some are public at the
 * edge (/api/files/download, for the cookieless OnlyOffice server), and for the
 * rest it is defense in depth behind the middleware.
 */
export async function hasAppSession(): Promise<boolean> {
  const s = await currentSession().catch(() => null);
  return isLiveSession(s);
}
