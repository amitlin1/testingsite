/**
 * Shipment data parsed from QR code
 */
export interface ShipmentData {
  shipmentNumber: string;
  customer: string;
  supplyDate: string;
  poc: string;
}

/**
 * Parse a shipment QR payload string back into ShipmentData
 * 
 * QR Format: "1|{shipmentNumber}|{customer}|{supplyDate}|{poc}"
 * 
 * @example
 * const qr = "1|345|45|07/01/2026|אטו";
 * const data = parseShipmentQr(qr);
 * // Returns: { shipmentNumber: "345", customer: "45", supplyDate: "07/01/2026", poc: "אטו" }
 * 
 * @param qrPayload - The scanned QR code string
 * @returns ShipmentData object or null if invalid format
 */
export function parseShipmentQr(qrPayload: string): ShipmentData | null {
  if (!qrPayload || typeof qrPayload !== 'string') {
    return null;
  }

  const parts = qrPayload.split('|');

  // Validate: must start with "1" and have at least 4 fields
  if (parts.length < 4 || parts[0] !== '1') {
    return null;
  }

  return {
    shipmentNumber: parts[1] || '',
    customer: parts[2] || '',
    supplyDate: parts[3] || '',
    poc: parts[4] || '', // May be empty
  };
}

/**
 * Validate if a string is a valid shipment QR payload
 * 
 * @param qrPayload - The string to validate
 * @returns true if valid shipment QR format
 */
export function isValidShipmentQr(qrPayload: string): boolean {
  if (!qrPayload || typeof qrPayload !== 'string') {
    return false;
  }

  const parts = qrPayload.split('|');
  return parts.length >= 4 && parts[0] === '1';
}

/**
 * Convert date from DD/MM/YYYY format (QR format) to YYYY-MM-DD (input date format)
 *
 * A barcode scanner "types" the payload as keystrokes, so on a Hebrew keyboard
 * layout the "/" key arrives as "." — accept "/", "." and "-" as separators,
 * and a year-first YYYY-MM-DD as well.
 *
 * @param dateStr - Date string in DD/MM/YYYY format
 * @returns Date string in YYYY-MM-DD format or null if invalid
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
  // Reject impossible dates (31/02, 13th month) — they'd make an Invalid Date downstream
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;

  return iso;
}
