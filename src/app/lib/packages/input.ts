import { parseDbId } from "@/lib/http/request";
import type { PackageItemInput } from "./create-package";

/** A number field of a request body: blank → null, anything not a finite number → null. */
export const numberField = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A text field of a request body, as sent (nothing → ""). */
export const textField = (v: unknown): string => (v == null ? "" : String(v));

/** One item of an intake request, or null without its type or serial. Makat,
 *  model and manufacturer are optional (the certificate may not have them). */
export function readItemInput(raw: Record<string, unknown>): PackageItemInput | null {
  const itemType = parseDbId(raw.itemType);
  const serialNumber = textField(raw.serialNumber).trim();
  if (itemType == null || !serialNumber) return null;
  return {
    itemType,
    serialNumber,
    makat: textField(raw.makat).trim(),
    model: textField(raw.model).trim(),
    manufacturer: textField(raw.manufacturer).trim(),
    manufacturerNo: raw.manufacturerNo == null ? null : textField(raw.manufacturerNo).trim(),
    routeNumber: numberField(raw.routeNumber),
  };
}
