import { prisma } from "@/app/lib/prisma";

/**
 * Shipments declare package types only (docs/packages/PLAN.md §9.10): the
 * declared lines are boxes, the items inside a box never appear on the
 * shipment. Returns the ids in `lines` whose type is NOT a package type (or
 * does not exist) so the shipment APIs can refuse them with one clear error.
 */
export async function nonPackageTypeIds(
  lines: { item_type_id?: number | null }[] | null | undefined,
): Promise<number[]> {
  const ids = [...new Set((lines ?? []).map((l) => Number(l?.item_type_id)).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return [];
  const rows = await prisma.item_types.findMany({
    where: { item_type_id: { in: ids } },
    select: { item_type_id: true, is_package: true },
  });
  const packageIds = new Set(rows.filter((r) => r.is_package).map((r) => r.item_type_id));
  return ids.filter((id) => !packageIds.has(id));
}
