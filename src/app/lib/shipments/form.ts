import type { ParsedItemData } from "@/app/lib/itemQrParser";
import { BUSINESS_TZ } from "@/lib/time/civil";
import type { NewShipment } from "./contract";

/**
 * The shipment forms' rules (new shipment, edit shipment), client-safe: what a
 * package line is, when it counts, and how a certificate row becomes one.
 */

/** A package line of the shipment form, with the certificate row it came from (if any). */
export type ShipmentLine = NonNullable<NewShipment["shipment_items"]>[number];

/** Above this many boxes a save asks once more: a typo of 500 for 50 would
 *  mint 500 boxes and print 500 labels. */
export const BIG_SHIPMENT = 100;

/** A line nobody started (no type, no quantity, no certificate row) — the
 *  form's blank row. It is left out of the save; anything else must be whole. */
export function lineIsEmpty(line: ShipmentLine | undefined): boolean {
  return !line?.item_type_id && !(Number(line?.quantity) > 0) && !line?.cert_row_raw;
}

/** Why a started line cannot be saved yet, or null. */
export function lineProblem(line: ShipmentLine | undefined): string | null {
  if (!line || lineIsEmpty(line)) return null;
  if (!line.item_type_id) return "יש לבחור סוג מארז";
  const qty = Number(line.quantity);
  if (!Number.isInteger(qty) || qty < 1) return "יש להזין כמות (לפחות 1)";
  return null;
}

/** The boxes the form declares: every started line's quantity. */
export function declaredBoxes(lines: ShipmentLine[] | undefined): number {
  return (lines ?? []).reduce((sum, l) => sum + (lineIsEmpty(l) ? 0 : Number(l?.quantity) || 0), 0);
}

/** The certificate rows already on the form — a second scan of one is refused. */
export function scannedRows(lines: ShipmentLine[] | undefined): string[] {
  return (lines ?? []).flatMap((l) => (l?.cert_row_raw ? [l.cert_row_raw] : []));
}

/** Puts confirmed rows into the form's package lines: an untouched empty line
 *  (a form starts with one) takes the first instead of staying blank above it. */
export function placeScannedLines(
  current: ShipmentLine[] | undefined,
  lines: ShipmentLine[],
  form: { update: (index: number, line: ShipmentLine) => void; append: (lines: ShipmentLine[]) => void },
) {
  const lastIdx = (current?.length ?? 0) - 1;
  const last = current?.[lastIdx];
  let rest = lines;
  if (last && lineIsEmpty(last) && !last.line_id && lines.length > 0) {
    form.update(lastIdx, lines[0]);
    rest = lines.slice(1);
  }
  if (rest.length > 0) form.append(rest);
}

/** The package line a confirmed certificate row becomes: the whole row goes
 *  with it, and the boxes minted from it pass makat / model / manufacturer to
 *  their items. */
export function certRowLine(row: ParsedItemData, line: { itemTypeId: number | null; quantity: number; makat: string }): ShipmentLine {
  return {
    item_type_id: line.itemTypeId ?? 0,
    quantity: line.quantity,
    makat: line.makat.trim() || null,
    model: row.model?.trim() || null,
    manufacturer_name: row.manufacturer.trim() || null,
    manufacturer_no: row.manufacturerNo.trim() || null,
    cert_row_no: row.rowNum.trim() || null,
    serial_no: row.serialNumber?.trim() || null,
    batch_size: row.batchSize.trim() || null,
    qty_to_test: row.qtyToTest,
    purchase_order: row.purchaseOrder.trim() || null,
    cert_row_raw: row.raw || null,
  };
}

/** "מהתעודה · שורה 2 · SONY 145DL · מק״ט 16321545 · הזמנה PO-778", read from
 *  the line itself — so a line saved earlier shows it too. A row typed by hand
 *  reads "הוזן ידנית · …"; a line of type and quantity alone gets none. */
export function certSummary(line: ShipmentLine | undefined): string | null {
  if (!line) return null;
  const typed = line.cert_row_no || line.manufacturer_name || line.model || line.makat || line.purchase_order || line.serial_no;
  if (!line.cert_row_raw && !typed) return null;
  return [
    line.cert_row_raw ? "מהתעודה" : "הוזן ידנית",
    line.cert_row_no ? `שורה ${line.cert_row_no}` : "",
    [line.manufacturer_name, line.model].filter(Boolean).join(" "),
    line.makat ? `מק״ט ${line.makat}` : "",
    line.purchase_order ? `הזמנה ${line.purchase_order}` : "",
  ].filter(Boolean).join(" · ");
}

/** A date as a date input holds it (YYYY-MM-DD), on the display clock. */
export function dateInputValue(value: Date | string | number): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ });
}
