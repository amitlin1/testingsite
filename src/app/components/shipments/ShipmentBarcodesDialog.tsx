"use client";
import React, { useRef } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
} from "@/components/ui";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import { Print as PrintIcon } from "@/components/ui/icons";
import { Shipment } from "@/types";
import { formatDate } from "@/app/lib/datetime";

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
    const shipmentDate = shipment ? formatDate(shipment.shipment_date) : "";

    const handlePrint = useReactToPrint({
        contentRef: printRef,
        documentTitle: shipment ? `Shipment-Labels-${shipment.shipment_code}` : "Shipment-Labels",
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle onClose={onClose}>
                הדפסת מדבקות למשלוח {shipment?.shipment_code ?? ""}
            </DialogTitle>
            <DialogContent dividers>
                {total <= 0 ? (
                    <Alert severity="info" style={{ marginTop: "var(--space-md)" }}>למשלוח זה לא הוגדרה כמות פריטים להדפסה</Alert>
                ) : (
                    <>
                        <p style={{ margin: "var(--space-md) 0", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                            יודפסו {total} מדבקות — מדבקה אחת לכל פריט, עם פרטי המשלוח ומספר מתוך סה״כ.
                        </p>
                        {/* Printable area: one label per item, each on its own page/label. */}
                        <div
                            style={{
                                maxHeight: 360,
                                overflowY: "auto",
                                border: "1px solid var(--color-hairline)",
                                borderRadius: "var(--r-sm)",
                                background: "var(--color-surface-pearl)",
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
                                                {/* <bdi>: RTL would print label 3 of 12 as "12 / 3" */}
                                                <bdi dir="ltr">{n} / {total}</bdi>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button variant="outlined" color="inherit" onClick={onClose}>סגור</Button>
                <Button
                    onClick={() => handlePrint()}
                    variant="contained"
                    startIcon={<PrintIcon fontSize={18} />}
                    disabled={total <= 0}
                >
                    הדפס הכל ({total})
                </Button>
            </DialogActions>
        </Dialog>
    );
}
