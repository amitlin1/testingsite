// Shared bits for the work-hours API. Every handler is gated to admin + משאן,
// both by the middleware (src/lib/routes.ts) and here (defense in depth).

import type { NextRequest } from "next/server";
import type { AppRole } from "@/lib/auth/roles";
import type { WithAuthCtx } from "@/lib/auth/withAuth";

export const WH_ROLES: AppRole[] = ["manager", "mashan"];

/** Who is making the change — stored in created_by / updated_by. */
export function actorOf(ctx: WithAuthCtx): string | null {
  const u = ctx.session.user as { preferredUsername?: string; name?: string | null } | undefined;
  return u?.preferredUsername ?? u?.name ?? null;
}

/**
 * withAuth forwards only (req, ctx) — not Next's route params — so dynamic
 * segments are recovered from the path. Returns the trailing segment after the
 * given anchor, e.g. lastSegmentAfter(req, "overrides") → "42".
 */
export function segmentAfter(req: NextRequest, anchor: string): string {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const i = parts.lastIndexOf(anchor);
  return i >= 0 ? (parts[i + 1] ?? "") : "";
}
