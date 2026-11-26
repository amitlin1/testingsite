import { NextResponse } from "next/server";

/**
 * Shared-secret guard for /api/cron/* endpoints.
 *
 * These routes are allowlisted in PUBLIC_ROUTES (src/lib/routes.ts) because the
 * an operator calls them by hand (curl, server-to-server) with NO browser
 * session cookie — so the auth middleware must let them through. (Until
 * 2026-11-26 Windows Task Scheduler called them; the app now runs its jobs
 * itself, src/instrumentation.ts.) To replace the gate the
 * middleware would otherwise provide, each cron handler calls this guard first.
 *
 * Contract: the caller sends `x-cron-secret: <CRON_SECRET>`. Then:
 *   - CRON_SECRET set   → require an exact header match, else 401.
 *   - CRON_SECRET unset → CLOSED (503). The endpoints run unauthenticated
 *     transactions against production data, so "not configured" must mean "off",
 *     not "open to anyone on the network" — a deploy that forgets the variable
 *     must not publish the jobs to the whole network.
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
