import React, { useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
} from "@/components/ui";
import { useReactToPrint } from 'react-to-print';
import { Print as PrintIcon } from "@/components/ui/icons";
import { ItemBarcode } from "@/app/components/labels/Labels";

type BarcodeDialogProps = {
    open: boolean;
    onClose: () => void;
    itemId: number | string;
};

export default function BarcodeDialog({ open, onClose, itemId }: BarcodeDialogProps) {
    const componentRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Barcode-${itemId}`,
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
                    <ItemBarcode ref={componentRef} id={itemId} />
                </Box>
            </DialogContent>
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
