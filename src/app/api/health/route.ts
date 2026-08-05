import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never cached — a cached 200 would keep reporting healthy after the app died.
export const dynamic = "force-dynamic";

/**
 * Container LIVENESS probe (docker healthcheck / nginx upstream readiness).
 *
 * Deliberately PUBLIC (see PUBLIC_ROUTES in lib/routes.ts) and deliberately
 * dependency-free: it answers "is this Next.js process serving HTTP?", nothing
 * more. Every other route is auth-gated, and the middleware answers a
 * credential-less non-browser request with 401 — so probing "/" would mark a
 * perfectly healthy container unhealthy.
 *
 * It does NOT touch Postgres, MinIO or Keycloak on purpose: a readiness probe
 * that fans out to every dependency turns one slow backend into a restart loop
 * and takes nginx down with it.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok", uptime: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
