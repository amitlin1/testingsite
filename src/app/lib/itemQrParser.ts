/**
 * The equipment barcode of a shipment certificate (shipment-QR_CODE-,
 * buildSingleRowPayload / buildEquipmentPayload): "2^" and one or more rows
 * joined by "^", each
 *   rowNum|manufacturerNo|manufacturerName|version|idfMakat|serialNum|batchSize|qtyToTest|orderNum
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
    qtyToTest: number;
    purchaseOrder: string;
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
        if (fields.length < 8) return null;
        const qty = parseInt(fields[7], 10);
        rows.push({
            rowNum: fields[0],
            manufacturerNo: fields[1],
            manufacturer: fields[2],
            model: fields[3] || null,
            makat: fields[4],
            serialNumber: fields[5] || null,
            batchSize: fields[6],
            // A unit's row may leave the quantity empty: it is one.
            qtyToTest: Number.isFinite(qty) && qty > 0 ? qty : 1,
            purchaseOrder: fields[8] ?? "",
            raw: rowPart.trim(),
        });
    }
    return rows.length > 0 ? rows : null;
}
