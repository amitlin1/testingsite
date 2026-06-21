/**
 * Helper function to parse barcode string
 * Format: "itemId-sourceId" or "itemId"
 * @param barcode - The barcode string to parse
 * @returns Object with itemId and optional sourceId
 */
export function parseBarcode(barcode: string): { itemId: number; sourceId?: number | null } {
  // פורמט: "itemId-sourceId" או "itemId"
  const parts = barcode.split('-');
  const itemId = Number(parts[0]);
  
  if (isNaN(itemId)) {
    throw new Error(`Invalid barcode format: ${barcode}`);
  }
  
  if (parts.length > 1 && parts[1]) {
    const sourceId = Number(parts[1]);
    return { itemId, sourceId: isNaN(sourceId) ? null : sourceId };
  }
  
  return { itemId, sourceId: null };
}

