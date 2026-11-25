import { packageTypeSummaries } from "@/app/lib/packages/template";
import { listJson } from "@/app/lib/lookups";

export const runtime = "nodejs";

/**
 * GET /api/settings/package-types — the list the "מארזים" settings screen
 * shows: every package type with the size of its template and whether the
 * routes involved obey the package rules (docs/packages/PLAN.md §4,
 * lib/packages/template.ts). Route problems are reported, never enforced here.
 */
export async function GET() {
  return listJson(packageTypeSummaries, "Error listing package types:", { emptyOnError: true });
}
