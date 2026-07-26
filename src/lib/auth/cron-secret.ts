import { NextResponse } from "next/server";

/**
 * Shared-secret guard for /api/cron/* endpoints.
 *
 * These routes are allowlisted in PUBLIC_ROUTES (src/lib/routes.ts) because the
 * Windows Task Scheduler calls them server-to-server with NO browser session
 * cookie — so the auth middleware must let them through. To replace the gate the
 * middleware would otherwise provide, each cron handler calls this guard first.
 *
 * Contract: the scheduler sends `x-cron-secret: <CRON_SECRET>`. Then:
 *   - CRON_SECRET set   → require an exact header match, else 401.
 *   - CRON_SECRET unset → OPEN (returns null), so local/dev manual runs stay
 *     frictionless.  ⚠ PRODUCTION MUST set CRON_SECRET on the server AND have the
 *     scheduler send the matching header, or these endpoints are unauthenticated.
 */
export function cronSecretGuard(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) return null; // not configured → open (dev convenience)
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided === expected) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
