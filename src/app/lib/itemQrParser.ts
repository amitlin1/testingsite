/**
 * The equipment barcode of a shipment certificate (shipment-QR_CODE-,
 * buildSingleRowPayload / buildEquipmentPayload): "2^" and one or more rows
 * joined by "^", each
 *   rowNum|manufacturerNo|manufacturerName|version|idfMakat|serialNum|batchSize|qtyToTest|orderNum[|shipmentNo]
 * Nine columns, or ten on certificates that also print their shipment number
 * on every row (so a row of another certificate is caught). Any other count
 * is not a row: a "|" inside a value, or a scan cut short.
 * A row with a serial is one unit; a row without one stands for several,
 * qtyToTest of which come to be tested.
 */
export type ParsedItemData = {
    /** מס"ד — the row's number on the certificate. */
    rowNum: string;
    manufacturerNo: string;
    manufacturer: string;
    makat: string;
    /** The version column. */
    model: string | null;
    serialNumber: string | null;
    /** גודל אצווה, as printed. */
    batchSize: string;
    /** How many come to be tested: 1 on a row with a serial; null when a
     *  batch row's column is not a number — the worker types it, nothing guesses. */
    qtyToTest: number | null;
    purchaseOrder: string;
    /** The certificate's shipment number, on rows that carry it (10 columns). */
    shipmentNumber: string | null;
    /** The row exactly as in the barcode — tells a second scan of it. */
    raw: string;
};

/** Every row of an equipment barcode, or null when the text is not one. */
export function parseItemQr(qrString: string): ParsedItemData[] | null {
    if (!qrString) return null;
    const [idPart, ...rowParts] = qrString.trim().split('^');
    if (idPart !== '2' || rowParts.length === 0) return null;

    const rows: ParsedItemData[] = [];
    for (const rowPart of rowParts) {
        if (!rowPart) continue;
        const fields = rowPart.split('|').map((f) => f.trim());
        if (fields.length !== 9 && fields.length !== 10) return null;
        const serialNumber = fields[5] || null;
        const qty = /^\d+$/.test(fields[7]) ? Number(fields[7]) : NaN;
        rows.push({
            rowNum: fields[0],
            manufacturerNo: fields[1],
            manufacturer: fields[2],
            model: fields[3] || null,
            makat: fields[4],
            serialNumber,
            batchSize: fields[6],
            qtyToTest: serialNumber ? 1 : qty > 0 ? qty : null,
            purchaseOrder: fields[8],
            shipmentNumber: fields[9] || null,
            raw: rowPart.trim(),
        });
    }
    return rows.length > 0 ? rows : null;
}

/** Two shipment numbers are the same certificate's when they match trimmed and case-blind. */
export const sameShipmentNumber = (a: string | null | undefined, b: string | null | undefined): boolean =>
    (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
