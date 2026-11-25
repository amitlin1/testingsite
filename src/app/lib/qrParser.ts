/** What the certificate's shipment barcode starts with. */
const SHIPMENT_QR_PREFIX = "1|";

export interface ShipmentData {
  shipmentNumber: string;
  customer: string;
  supplyDate: string;
  poc: string;
}

/**
 * The certificate's shipment barcode: "1|{shipmentNumber}|{customer}|{supplyDate}|{poc}", e.g.
 * "1|345|45|07/01/2026|אטו". The certificate tool always writes all five fields (the POC may be
 * empty, "…|"), so any other count is not a shipment barcode: a "|" inside a value, or a scan read
 * before it finished.
 */
export function parseShipmentQr(qrPayload: string): ShipmentData | null {
  if (!qrPayload || typeof qrPayload !== 'string') {
    return null;
  }

  const parts = qrPayload.split('|');

  if (parts.length !== 5 || parts[0] !== '1') {
    return null;
  }

  return {
    shipmentNumber: parts[1] || '',
    customer: parts[2] || '',
    supplyDate: parts[3] || '',
    poc: parts[4] || '', // May be empty
  };
}

export function isValidShipmentQr(qrPayload: string): boolean {
  return parseShipmentQr(qrPayload) != null;
}

/** Text that starts like the certificate's shipment barcode — for a field that
 *  takes something else to say "that is the shipment barcode", even when the
 *  scan was garbled. */
export function looksLikeShipmentQr(text: string): boolean {
  return typeof text === 'string' && text.trim().startsWith(SHIPMENT_QR_PREFIX);
}

/**
 * The barcode's DD/MM/YYYY date as YYYY-MM-DD (a date input's value), or null when it is not a
 * real date. A barcode scanner "types" the payload as keystrokes, so on a Hebrew keyboard layout
 * the "/" key arrives as "." — accept "/", "." and "-" as separators, and a year-first YYYY-MM-DD
 * as well.
 */
export function convertQrDateToInputFormat(dateStr: string): string | null {
  if (!dateStr) return null;

  const parts = dateStr.trim().split(/[/.\-]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;

  let [day, month, year] = parts;
  if (parts[0].length === 4) [year, month, day] = parts;
  if (year.length === 2) year = `20${year}`;
  if (year.length !== 4) return null;

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;

  return iso;
}
