import { TransactionClient } from "@/app/lib/prisma";

/**
 * What a routed row is in the package model: the box itself, an item inside a
 * box, or a legacy standalone row (pre-conversion, no package). One query,
 * used by every write path that has to decide whether to act on a group.
 */
export type PackageContext = {
  itemId: bigint;
  /** items.package_id — set for an item inside a box. */
  packageId: bigint | null;
  /** The row's item type is a package type (and it is not inside a box). */
  isPackage: boolean;
  itemTypeId: number;
};

export async function loadPackageContext(
  tx: Pick<TransactionClient, "$queryRaw">,
  itemId: bigint,
): Promise<PackageContext | null> {
  const rows = await tx.$queryRaw<{ item_id: bigint; package_id: bigint | null; is_package: boolean; item_type_id: number }[]>`
    SELECT it.item_id, it.package_id, ty.is_package, it.item_type_id
    FROM items it
    JOIN item_types ty ON ty.item_type_id = it.item_type_id
    WHERE it.item_id = ${itemId}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    itemId: r.item_id,
    packageId: r.package_id,
    isPackage: r.is_package && r.package_id == null,
    itemTypeId: r.item_type_id,
  };
}

/** Is this station type a package-level one (opening / closing)? */
export async function isPackageLevelStationType(
  tx: Pick<TransactionClient, "test_stations_type">,
  stationTypeId: number | null | undefined,
): Promise<boolean> {
  if (stationTypeId == null) return false;
  const row = await tx.test_stations_type.findUnique({
    where: { test_station_type_id: stationTypeId },
    select: { package_level: true },
  });
  return row?.package_level === true;
}
