/**
 * The client-safe half of lib/packages/serials.ts (no database import): how
 * two serials compare, and the shape POST /api/items/serials answers with.
 */

/** Two serials are the same label when they match trimmed and case-blind ("ab-12 " = "AB-12"). */
export const serialKey = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

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
