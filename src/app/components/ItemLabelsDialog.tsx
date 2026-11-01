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
} from "@/components/ui";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import { Print as PrintIcon } from "@/components/ui/icons";

/** A single ID label to print — one per physical item. The label carries the
 *  code only (barcode + digits); serialNo / title / role are not printed. */
export type ItemLabel = {
    itemId: number;
    /** Same source as the parent package; encoded as "itemId-sourceId" like the rest of the app. */
    sourceId?: number | null;
    serialNo?: string | null;
    /** Item type / model text. */
    title?: string | null;
    /** "פריט אב" / "פריט נלווה". */
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
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            {/* The shared title: one size, the one named × at the inline end. */}
            <DialogTitle onClose={onClose}>{heading ?? "הדפסת מדבקות ID"}</DialogTitle>
            {/* Top divider only — DialogActions draws the line above the footer. */}
            <DialogContent style={{ borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
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
                                border: "1px solid var(--color-hairline)",
                                borderRadius: "var(--r-md)",
                                bgcolor: "var(--color-surface-pearl)",
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
                                        {/* A label carries the code only: the barcode and its digits. */}
                                        <Barcode value={barcodeOf(l)} width={2} height={80} fontSize={16} />
                                    </div>
                                ))}
                            </div>
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>
                <Button
                    onClick={() => handlePrint()}
                    variant="contained"
                    startIcon={<PrintIcon fontSize={18} />}
                    disabled={labels.length === 0}
                >
                    הדפס הכל ({labels.length})
                </Button>
            </DialogActions>
        </Dialog>
    );
}
