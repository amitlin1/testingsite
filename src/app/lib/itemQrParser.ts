
export type ParsedItemData = {
    manufacturerNo: string;
    manufacturer: string;
    makat: string;
    model: string | null;
    serialNumber: string | null;
    qtyToTest: number;
};

export function parseItemQr(qrString: string): ParsedItemData | null {
    try {
        if (!qrString) return null;

        // Split by caret to separate ID from data
        const [idPart, dataPart] = qrString.split('^');

        // Check ID - must be 2 for item
        if (idPart !== '2') {
            console.warn('Invalid QR code type. Expected 2 (Item), got:', idPart);
            return null;
        }

        if (!dataPart) return null;

        // Split data part by pipe
        const fields = dataPart.split('|');

        // Format: rowNum|manfucaterNo|manfucaterName|version|idfMakat|serialNum|qtyBought|qtyTotest|orderNum
        // Indices:
        // 0: rowNum
        // 1: manufacturerNo
        // 2: manufacturerName
        // 3: version
        // 4: idfMakat
        // 5: serialNum (can be empty)
        // 6: qtyBought
        // 7: qtyTotest
        // 8: orderNum

        if (fields.length < 8) {
            console.warn('Insufficient fields in QR code data');
            return null;
        }

        const manufacturerNo = fields[1];
        const manufacturer = fields[2];
        const model = fields[3] || null; // version field = model
        const makat = fields[4];
        const serialNumber = fields[5] || null; // Convert empty string to null
        const qtyToTest = parseInt(fields[7], 10);

        if (isNaN(qtyToTest)) {
            console.warn('Invalid qtyToTest');
            return null;
        }

        return {
            manufacturerNo,
            manufacturer,
            model,
            makat,
            serialNumber,
            qtyToTest
        };

    } catch (error) {
        console.error('Error parsing item QR:', error);
        return null;
    }
}
