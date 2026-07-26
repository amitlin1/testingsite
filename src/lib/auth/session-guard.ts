import { auth } from "@/../auth";

/**
 * True when the current request carries a valid (non-terminal) app session.
 *
 * Use this to self-guard FILE-serving route handlers whose URL contains a dot
 * (a filename with an extension) — those paths are excluded by the edge
 * middleware matcher, so they are NOT gated by the middleware and must check the
 * session themselves. Any authenticated user passes (no role restriction).
 */
export async function hasAppSession(): Promise<boolean> {
  const s = await auth().catch(() => null);
  return !!(s?.user && s.error !== "RefreshAccessTokenError");
}
