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
 *   - CRON_SECRET unset → CLOSED (503). The endpoints run unauthenticated
 *     transactions against production data, so "not configured" must mean "off",
 *     not "open to anyone on the network". This used to return null (open) for
 *     dev convenience; a deploy that forgot the variable silently published
 *     snapshot creation to the whole network.
 *
 * To run a job manually (dev or prod), set CRON_SECRET on the server and send
 * the matching header — there is no unauthenticated path any more.
 */
export function cronSecretGuard(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(
      "[cron] CRON_SECRET is not set — /api/cron/* is disabled. Set it on the server and in the scheduler to enable these jobs.",
    );
    return NextResponse.json(
      { error: "Cron endpoints are disabled (CRON_SECRET not configured)" },
      { status: 503 },
    );
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (provided === expected) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
