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

/** A line's columns as sent by the shipment forms: the makat, and the whole
 *  certificate row it was scanned from (lib/itemQrParser.ts). The line's boxes
 *  are minted with makat / model / manufacturer and pass them to their items
 *  (boxes.ts); the rest is kept as the certificate says. Blank = not given. */
export function lineDetails(line: Record<string, unknown>) {
  const text = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    return s || null;
  };
  const qty = Number(line.qty_to_test);
  return {
    makat: text(line.makat),
    model: text(line.model),
    manufacturer_name: text(line.manufacturer_name),
    manufacturer_no: text(line.manufacturer_no),
    cert_row_no: text(line.cert_row_no),
    serial_no: text(line.serial_no),
    batch_size: text(line.batch_size),
    qty_to_test: line.qty_to_test != null && Number.isInteger(qty) && qty > 0 ? qty : null,
    purchase_order: text(line.purchase_order),
    cert_row_raw: text(line.cert_row_raw),
  };
}
