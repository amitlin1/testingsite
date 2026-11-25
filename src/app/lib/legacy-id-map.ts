import { prisma } from "@/lib/db";

/**
 * `legacy_id_map`: the old → new item ids the production package upgrade wrote
 * (scripts/prod-package-model), so a label printed before it still finds its
 * item. The table exists only where the upgrade ran, and a database upgraded
 * with the first version of the one-shot has it without `relabeled_at` (the
 * rebuilt one-shot adds it idempotently) — so it is probed before it is read
 * (docs/PRISMA_UNMANAGED_OBJECTS.md).
 */
export async function legacyIdMapShape(): Promise<{ exists: boolean; hasRelabeled: boolean }> {
  const probe = await prisma.$queryRaw<{ ok: boolean; col: boolean }[]>`
    SELECT to_regclass('public.legacy_id_map') IS NOT NULL AS ok,
           EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'legacy_id_map' AND column_name = 'relabeled_at') AS col
  `;
  return { exists: !!probe[0]?.ok, hasRelabeled: !!probe[0]?.col };
}

/** The item an old label's id was converted to, or null (no map, or not a converted id). */
export async function resolveLegacyId(legacyId: bigint): Promise<bigint | null> {
  if (!(await legacyIdMapShape()).exists) return null;
  const rows = await prisma.$queryRaw<{ new_id: bigint | number | null }[]>`
    SELECT new_id FROM legacy_id_map WHERE legacy_id = ${legacyId} ORDER BY converted_at DESC LIMIT 1
  `;
  const v = rows[0]?.new_id;
  return v == null ? null : BigInt(v);
}
