import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { loadPackages } from "@/app/lib/packages/read";

export const runtime = "nodejs";

/**
 * The boxes the production upgrade made out of legacy items
 * (scripts/prod-package-model). Their physical labels still carry the old
 * item ids until new ones are printed; the map lives in `legacy_id_map`,
 * which exists only where the upgrade ran (docs/PRISMA_UNMANAGED_OBJECTS.md).
 *
 *   GET  /api/packages/converted
 *        { packages: PackageView[], legacy: [{ legacy_id, new_id, package_id }] }
 *        — every converted box not yet marked as relabeled. Empty where the
 *        upgrade never ran.
 *   POST /api/packages/converted   { packageIds: string[] }
 *        — marks those boxes relabeled (their new labels were printed), so
 *        they drop out of the list. Answers { ok, updated }.
 */
type LegacyRow = { legacy_id: bigint | number; new_id: bigint | number; package_id: bigint | number | null };

/** Whether the map exists, and whether it has the `relabeled_at` column (a
 *  database upgraded with the first version of the one-shot has the table
 *  without it; the rebuilt one-shot adds it idempotently). */
async function mapShape(): Promise<{ exists: boolean; hasRelabeled: boolean }> {
  const probe = await prisma.$queryRaw<{ ok: boolean; col: boolean }[]>`
    SELECT to_regclass('public.legacy_id_map') IS NOT NULL AS ok,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'legacy_id_map' AND column_name = 'relabeled_at') AS col
  `;
  return { exists: !!probe[0]?.ok, hasRelabeled: !!probe[0]?.col };
}

export async function GET() {
  try {
    const shape = await mapShape();
    if (!shape.exists) return NextResponse.json({ packages: [], legacy: [] });
    // Without the column nothing can be marked, so every converted box is listed.
    const rows = shape.hasRelabeled
      ? await prisma.$queryRaw<LegacyRow[]>`
          SELECT legacy_id, new_id, package_id
          FROM legacy_id_map
          WHERE relabeled_at IS NULL AND package_id IS NOT NULL
          ORDER BY package_id, package_seq
        `
      : await prisma.$queryRaw<LegacyRow[]>`
          SELECT legacy_id, new_id, package_id
          FROM legacy_id_map
          WHERE package_id IS NOT NULL
          ORDER BY package_id, package_seq
        `;
    const legacy = rows.map((r) => ({
      legacy_id: String(r.legacy_id),
      new_id: String(r.new_id),
      package_id: r.package_id == null ? null : String(r.package_id),
    }));
    const ids = [...new Set(legacy.map((l) => l.package_id).filter((v): v is string => v != null))];
    const packages = ids.length ? await loadPackages({ ids: ids.map((id) => BigInt(id)) }) : [];
    return NextResponse.json({ packages, legacy });
  } catch (error) {
    console.error("Error listing converted packages:", error);
    return NextResponse.json({ error: "טעינת המארזים שהוסבו נכשלה" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw: unknown = body?.packageIds;
    // Package ids are 16 digits; 18 keeps every value inside int8.
    const packageIds = Array.isArray(raw) ? raw.map((v) => String(v)).filter((v) => /^\d{1,18}$/.test(v)) : [];
    if (packageIds.length === 0) return NextResponse.json({ error: "packageIds is required" }, { status: 400 });
    const shape = await mapShape();
    if (!shape.exists) return NextResponse.json({ ok: true, updated: 0 });
    if (!shape.hasRelabeled) {
      return NextResponse.json({ error: "לטבלת legacy_id_map חסרה העמודה relabeled_at — הרץ: ALTER TABLE legacy_id_map ADD COLUMN relabeled_at timestamptz" }, { status: 409 });
    }
    const updated = await prisma.$executeRaw`
      UPDATE legacy_id_map SET relabeled_at = now()
      WHERE relabeled_at IS NULL AND package_id = ANY(${packageIds.map((id) => BigInt(id))}::bigint[])
    `;
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    console.error("Error marking packages relabeled:", error);
    return NextResponse.json({ error: "סימון המארזים נכשל" }, { status: 500 });
  }
}
