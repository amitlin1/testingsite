"use client";
import React, { useRef } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Alert,
    IconButton,
} from "@/components/ui";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import { Print as PrintIcon } from "@/components/ui/icons";
import { Close as CloseIcon } from "@/components/ui/icons";
import { QrCode2 as QrCode2Icon } from "@/components/ui/icons";

/** A single ID label to print — one per physical item. */
export type ItemLabel = {
    itemId: number;
    /** Same source as the parent package; encoded as "itemId-sourceId" like the rest of the app. */
    sourceId?: number | null;
    serialNo?: string | null;
    /** Item type / model text shown under the barcode. */
    title?: string | null;
    /** "פריט אב" / "פריט נלווה" — printed so the physical label says what it is. */
    role?: string;
};

type ItemLabelsDialogProps = {
    open: boolean;
    onClose: () => void;
    labels: ItemLabel[];
    heading?: string;
    /** Fired once a print job has been sent — lets the caller record that labels were printed. */
    onPrinted?: () => void;
};

/**
 * Prints one ID barcode label per item — used by the intake wizard to label
 * every item found inside a package (parent + accessories) in a single job.
 * Unlike BarcodeDialog (single item), each label here gets its own page.
 */
export default function ItemLabelsDialog({ open, onClose, labels, heading, onPrinted }: ItemLabelsDialogProps) {
    const printRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: "Item-ID-Labels",
        onAfterPrint: onPrinted,
    });

    const barcodeOf = (l: ItemLabel) => (l.sourceId ? `${l.itemId}-${l.sourceId}` : String(l.itemId));

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <QrCode2Icon color="primary" />
                    <Typography variant="h6" component="span" fontWeight="bold">
                        {heading ?? "הדפסת מדבקות ID"}
                    </Typography>
                </Box>
                <IconButton onClick={onClose}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {labels.length === 0 ? (
                    <Alert severity="info">אין פריטים להדפסת מדבקות</Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            יודפסו {labels.length} מדבקות — מדבקה אחת לכל פריט במארז, עם ה-ID שלו.
                        </Typography>
                        <Box
                            sx={{
                                maxHeight: 360,
                                overflowY: "auto",
                                border: "1px solid #e0e0e0",
                                borderRadius: 2,
                                bgcolor: "#fafafa",
                            }}
                        >
                            <div ref={printRef}>
                                {labels.map((l, i) => (
                                    <div
                                        key={`${l.itemId}-${i}`}
                                        style={{
                                            padding: "20px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            pageBreakAfter: "always",
                                            breakAfter: "page",
                                        }}
                                    >
                                        <Barcode value={barcodeOf(l)} width={2} height={80} fontSize={16} />
                                        <div style={{ marginTop: 8, textAlign: "center", direction: "rtl" }}>
                                            {l.role && <div style={{ fontSize: 13, fontWeight: 700 }}>{l.role}</div>}
                                            {l.title && <div style={{ fontSize: 14 }}>{l.title}</div>}
                                            {l.serialNo && <div style={{ fontSize: 13 }}>S/N: {l.serialNo}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>סגור</Button>
                <Button
                    onClick={() => handlePrint()}
                    variant="contained"
                    startIcon={<PrintIcon sx={{ ml: 1 }} />}
                    disabled={labels.length === 0}
                >
                    הדפס הכל ({labels.length})
                </Button>
            </DialogActions>
        </Dialog>
    );
}
