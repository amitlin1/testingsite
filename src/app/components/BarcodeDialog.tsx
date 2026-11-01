import React, { useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
} from "@/components/ui";
import Barcode from 'react-barcode';
import { useReactToPrint } from 'react-to-print';
import { Print as PrintIcon } from "@/components/ui/icons";

type BarcodeDialogProps = {
    open: boolean;
    onClose: () => void;
    itemId: number;
};

export default function BarcodeDialog({ open, onClose, itemId }: BarcodeDialogProps) {
    const componentRef = useRef<HTMLDivElement>(null);

    const barcodeValue = itemId.toString();

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Barcode-${barcodeValue}`,
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle onClose={onClose}>הדפסת ברקוד</DialogTitle>
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
                        {/* A label carries the code only: the barcode and its digits. */}
                        <Barcode value={barcodeValue} width={2} height={100} fontSize={16} />
                    </div>
                </Box>
            </DialogContent>
            {/* Close then the action; DialogActions keeps the filled one last. */}
            <DialogActions>
                <Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>
                <Button
                    onClick={() => handlePrint()}
                    variant="contained"
                    startIcon={<PrintIcon fontSize={18} />}
                >
                    הדפס
                </Button>
            </DialogActions>
        </Dialog>
    );
}
