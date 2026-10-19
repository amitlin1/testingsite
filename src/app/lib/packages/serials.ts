import { prisma, TransactionClient } from "@/app/lib/prisma";
import { PackageError } from "./errors";
import { serialKey, type SerialMatch } from "./serial-key";

export { serialKey, type SerialMatch };

/**
 * Serial numbers at intake. Two serials are the same label when they match
 * trimmed and case-blind (serialKey).
 *
 * The hard rule: a box never carries the same serial twice, and a shipment
 * never holds two items of the same type with the same serial — that is a
 * double scan, not a second unit. The same serial anywhere else (another
 * type, another shipment: a unit back for a retest) is only reported to the
 * worker, never refused.
 *
 * The rule lives in the routes, not in createPackage / addPackageItem, so
 * the write path's own tests keep their fixed serials.
 */

/** Items already carrying any of these serials, newest first. */
export async function findSerials(db: TransactionClient | typeof prisma, serials: string[]): Promise<SerialMatch[]> {
  const keys = [...new Set(serials.map(serialKey).filter(Boolean))];
  if (keys.length === 0) return [];
  const rows = await db.$queryRaw<(Omit<SerialMatch, "item_id" | "package_id"> & { item_id: bigint; package_id: bigint | null })[]>`
    SELECT UPPER(TRIM(i.serial_no)) AS serial, i.item_id, i.item_type_id, TRIM(t.item_type_desc) AS item_type_desc,
           i.shipment_id, TRIM(s.shipment_code) AS shipment_code, i.package_id
    FROM items i
    JOIN item_types t ON t.item_type_id = i.item_type_id
    LEFT JOIN shipments s ON s.id = i.shipment_id
    WHERE i.serial_no IS NOT NULL AND UPPER(TRIM(i.serial_no)) = ANY(${keys}::text[])
    ORDER BY i.item_id DESC
    LIMIT 1000
  `;
  return rows.map((r) => ({ ...r, item_id: Number(r.item_id), package_id: r.package_id == null ? null : Number(r.package_id) }));
}

/** The same rule when an existing item's serial or type is edited: no other
 *  item of its shipment, of the (new) type, may carry the serial. Nothing is
 *  checked when neither changed, so an edit of other fields never trips on
 *  old data. */
export async function assertSerialFreeForItem(
  tx: TransactionClient,
  itemId: bigint,
  itemType: number,
  serialNumber: string,
): Promise<void> {
  const row = await tx.items.findUnique({ where: { item_id: itemId }, select: { shipment_id: true, item_type_id: true, serial_no: true } });
  const key = serialKey(serialNumber);
  if (!row || !key || (key === serialKey(row.serial_no) && itemType === row.item_type_id)) return;
  const clash = (await findSerials(tx, [serialNumber])).find(
    (m) => m.shipment_id === row.shipment_id && m.item_type_id === itemType && m.item_id !== Number(itemId),
  );
  if (clash) {
    throw new PackageError("ITEM_SERIAL_EXISTS", `הסריאלי ${serialNumber.trim()} כבר קיים במשלוח הזה על ${clash.item_type_desc} אחר`, 409);
  }
}

/** Refuses the hard-rule duplicates; `itemIndex` on the error names the row. */
export async function assertSerialsFree(
  tx: TransactionClient,
  shipmentId: number,
  items: { itemType: number; serialNumber: string }[],
): Promise<void> {
  const types = await tx.item_types.findMany({
    where: { item_type_id: { in: [...new Set(items.map((i) => i.itemType))] } },
    select: { item_type_id: true, item_type_desc: true },
  });
  const desc = (t: number) => types.find((x) => x.item_type_id === t)?.item_type_desc.trim() ?? "פריט";

  const seen = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const key = serialKey(items[i].serialNumber);
    const first = seen.get(key);
    if (first != null) {
      throw new PackageError("ITEM_SERIAL_DUPLICATE", `${desc(items[i].itemType)}: הסריאלי ${items[i].serialNumber.trim()} כבר הוזן בשורה ${first + 1}`, 409, i);
    }
    seen.set(key, i);
  }

  const existing = await findSerials(tx, items.map((i) => i.serialNumber));
  for (let i = 0; i < items.length; i++) {
    const key = serialKey(items[i].serialNumber);
    if (existing.some((m) => m.serial === key && m.shipment_id === shipmentId && m.item_type_id === items[i].itemType)) {
      throw new PackageError("ITEM_SERIAL_EXISTS", `${desc(items[i].itemType)}: הסריאלי ${items[i].serialNumber.trim()} כבר נקלט במשלוח הזה`, 409, i);
    }
  }
}
