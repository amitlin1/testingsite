import React, { useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography
} from "@/components/ui";
import Barcode from 'react-barcode';
import { useReactToPrint } from 'react-to-print';
import { Print as PrintIcon } from "@/components/ui/icons";

type BarcodeDialogProps = {
    open: boolean;
    onClose: () => void;
    itemId: number;
    sourceId?: number | null;
    itemSerial?: string;
};

export default function BarcodeDialog({ open, onClose, itemId, sourceId, itemSerial }: BarcodeDialogProps) {
    const componentRef = useRef<HTMLDivElement>(null);

    // פורמט ברקוד: itemId-sourceId (אם sourceId קיים)
    const barcodeValue = sourceId ? `${itemId}-${sourceId}` : itemId.toString();

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Barcode-${barcodeValue}`,
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>הדפסת ברקוד</DialogTitle>
            <DialogContent>
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 4,
                        minHeight: 200
                    }}
                >
                    <div ref={componentRef} style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Barcode value={barcodeValue} width={2} height={100} fontSize={16} />
                        {itemSerial && (
                            <Typography variant="caption" sx={{ mt: 1 }}>
                                S/N: {itemSerial}
                            </Typography>
                        )}
                    </div>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>סגור</Button>
                <Button
                    onClick={() => handlePrint()}
                    variant="contained"
                    startIcon={<PrintIcon sx={{ ml: 1 }} />}
                >
                    הדפס
                </Button>
            </DialogActions>
        </Dialog>
    );
}
