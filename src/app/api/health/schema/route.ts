import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
// Never cached — a cached version would defeat the app-before-DB guard.
export const dynamic = "force-dynamic";

/**
 * GET /api/health/schema — the metrics-schema version the database carries.
 *
 * Deliberately PUBLIC (the /api/health prefix in PUBLIC_ROUTES covers it):
 * `4-verify.ps1` calls it server-to-server with no session, immediately after
 * `3-start`, before the deploy is declared healthy (plan §8 stage 2 / §10.2).
 * The write path refuses to serve when this version is below the image's
 * minimum, so this endpoint is how an operator sees "app image newer than DB"
 * before any worker does.
 *
 * Unlike /api/health (pure liveness), this one MUST touch Postgres — the whole
 * point is proving the migration landed. A missing table or unreachable DB is
 * therefore a 500, not a masked 200.
 */
export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ version: number }[]>`
      SELECT version FROM metrics_schema_version WHERE id = 1`;
    const version = rows[0]?.version;
    if (version === undefined) {
      return NextResponse.json(
        { error: "metrics_schema_version has no row" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("Error reading metrics schema version:", error);
    return NextResponse.json(
      { error: "Failed to read metrics schema version", message: error.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
