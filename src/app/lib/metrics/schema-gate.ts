import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * Refuse-to-serve gate for the metrics write path (§8 stage 3).
 *
 * The DB server and the app server are separate machines with no version
 * handshake; an app image whose write path calls metrics_record() against a
 * DB that hasn't had migration A applied would fail every worker submission
 * with an opaque 500. This gate turns that into a loud, explicit 503 at the
 * top of every write route ("failed startup" semantics instead of a silently
 * broken floor). 4-verify.ps1 asserts the same condition right after 3-start.
 *
 * The check is cached for a short TTL so it is not a per-request query: once
 * the schema is confirmed current it can only move FORWARD (migrations bump
 * the version, never lower it), so serving from a 30s-stale "ok" is safe.
 * Failures are NOT cached — a broken deploy keeps re-checking and stays loud.
 */
export const REQUIRED_METRICS_SCHEMA_VERSION = 1;

const CACHE_TTL_MS = 30_000;

let lastOkAt = 0;

/**
 * Returns null when the DB schema is current enough for this image, or a
 * 503 NextResponse the route must return as-is. Same call shape as
 * cronSecretGuard: `const denied = await metricsSchemaGate(); if (denied) return denied;`
 */
export async function metricsSchemaGate(): Promise<NextResponse | null> {
  if (Date.now() - lastOkAt < CACHE_TTL_MS) return null;

  let version: number | null = null;
  try {
    const rows = await prisma.$queryRaw<{ version: number }[]>`
      SELECT version FROM metrics_schema_version WHERE id = 1
    `;
    version = rows[0]?.version ?? null;
  } catch (error) {
    // Table missing (migration A never applied) or DB unreachable — both mean
    // the write path's guarantees don't hold. Refuse loudly.
    console.error("[metrics] schema gate: cannot read metrics_schema_version:", error);
    return NextResponse.json(
      { error: "Metrics schema unavailable — DB migration A has not been applied (or DB is down)" },
      { status: 503 },
    );
  }

  if (version == null || version < REQUIRED_METRICS_SCHEMA_VERSION) {
    console.error(
      `[metrics] schema gate: DB metrics_schema_version=${version ?? "none"} < required ${REQUIRED_METRICS_SCHEMA_VERSION} — refusing to serve writes`,
    );
    return NextResponse.json(
      {
        error: "Metrics schema out of date — refusing to serve writes",
        dbVersion: version,
        requiredVersion: REQUIRED_METRICS_SCHEMA_VERSION,
      },
      { status: 503 },
    );
  }

  lastOkAt = Date.now();
  return null;
}

/** Test hook: forget the cached "ok" so the next call re-queries the DB. */
export function resetMetricsSchemaGateCache(): void {
  lastOkAt = 0;
}
