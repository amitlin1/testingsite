/**
 * The client-safe half of lib/packages/serials.ts (no database import): how
 * two serials compare, and the shape POST /api/items/serials answers with.
 */

/** Two serials are the same label when they match trimmed and case-blind ("ab-12 " = "AB-12"). */
export const serialKey = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

/**
 * Why this cannot be a serial, or null. "|" and "^" are the certificate
 * barcodes' separators: a serial holding them is a certificate row (or the
 * shipment barcode) scanned into the serial field by a scanner that sends no
 * Enter, so nothing read it as a barcode.
 */
export function serialProblem(s: string | null | undefined): string | null {
  return /[|^]/.test(s ?? "") ? "זה ברקוד מתעודת המשלוח, לא מספר סריאלי — סרוק שוב עם Enter או הקלד את הסריאלי" : null;
}

export type SerialMatch = {
  /** The serial as compared: trimmed, upper case. */
  serial: string;
  item_id: number;
  item_type_id: number;
  item_type_desc: string;
  shipment_id: number;
  shipment_code: string | null;
  package_id: number | null;
};
