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
import { Shipment } from "@/types";

type ShipmentBarcodesDialogProps = {
    open: boolean;
    onClose: () => void;
    shipment: Shipment | null;
};

export default function ShipmentBarcodesDialog({ open, onClose, shipment }: ShipmentBarcodesDialogProps) {
    const printRef = useRef<HTMLDivElement>(null);

    // One label per item in the shipment's declared total. These are SHIPMENT
    // labels (the per-item barcode is only generated once an item enters the
    // testing route) — each label carries the shipment details + a running
    // "N / total" counter so every physical unit can be matched to the shipment.
    const total = shipment?.amount ?? 0;
    const labels = Array.from({ length: total }, (_, i) => i + 1);

    // The barcode encodes the shipment number so a scan resolves to the shipment.
    const barcodeValue = shipment?.shipment_code ?? "";
    const shipmentDate = shipment ? new Date(shipment.shipment_date).toLocaleDateString("he-IL") : "";

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: shipment ? `Shipment-Labels-${shipment.shipment_code}` : "Shipment-Labels",
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <QrCode2Icon color="primary" />
                    <Typography variant="h6" component="span" fontWeight="bold">
                        הדפסת מדבקות למשלוח {shipment?.shipment_code ?? ""}
                    </Typography>
                </Box>
                <IconButton onClick={onClose}>
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {total <= 0 ? (
                    <Alert severity="info">למשלוח זה לא הוגדרה כמות פריטים להדפסה</Alert>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            יודפסו {total} מדבקות — מדבקה אחת לכל פריט, עם פרטי המשלוח ומספר מתוך סה״כ.
                        </Typography>
                        {/* Printable area: one label per item, each on its own page/label. */}
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
                                {labels.map((n) => (
                                    <div
                                        key={n}
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
                                        <Barcode value={barcodeValue} width={2} height={80} fontSize={16} />
                                        <div style={{ marginTop: 8, textAlign: "center", direction: "rtl" }}>
                                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                                                משלוח: {shipment?.shipment_code}
                                            </div>
                                            <div style={{ fontSize: 13 }}>לקוח: {shipment?.customer_code}</div>
                                            <div style={{ fontSize: 13 }}>תאריך: {shipmentDate}</div>
                                            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                                                {n} / {total}
                                            </div>
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
                    disabled={total <= 0}
                >
                    הדפס הכל ({total})
                </Button>
            </DialogActions>
        </Dialog>
    );
}
