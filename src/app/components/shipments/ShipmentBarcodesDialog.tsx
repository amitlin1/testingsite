"use client";
import React, { useRef } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    Skeleton,
} from "@/components/ui";
import Barcode from "react-barcode";
import { useReactToPrint } from "react-to-print";
import { Print as PrintIcon } from "@/components/ui/icons";
import { Shipment } from "@/types";
import { formatDate } from "@/app/lib/datetime";
import { apiFetch } from "@/lib/api/client";
import type { PackageView } from "@/app/lib/packages/read";
import { barcodeOf, fmtId } from "@/app/components/packages/packageUi";

type ShipmentBarcodesDialogProps = {
    open: boolean;
    onClose: () => void;
    shipment: Shipment | null;
};

/**
 * One label per BOX of the shipment, each with the box's own id (16 digits
 * ending in 00) as its barcode — the label the intake scans. The boxes are
 * minted when the shipment is saved (lib/packages/boxes.ts); opening this
 * asks the server for them, which also mints the missing ones of a shipment
 * saved before that. Item labels print later, at the opening station.
 */
export default function ShipmentBarcodesDialog({ open, onClose, shipment }: ShipmentBarcodesDialogProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const [boxes, setBoxes] = React.useState<PackageView[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const shipmentId = shipment?.id ?? null;

    React.useEffect(() => {
        if (!open || shipmentId == null) return;
        let cancelled = false;
        apiFetch(`/api/shipments/${shipmentId}/boxes`, { method: "POST" })
            .then(async (r) => {
                const d = await r.json().catch(() => ({}));
                if (cancelled) return;
                if (!r.ok) { setError(d?.error || "טעינת מארזי המשלוח נכשלה"); setBoxes([]); return; }
                setError(null);
                setBoxes(Array.isArray(d.boxes) ? d.boxes : []);
            })
            .catch(() => { if (!cancelled) { setError("שגיאה בתקשורת"); setBoxes([]); } });
        return () => { cancelled = true; setBoxes(null); };
    }, [open, shipmentId]);

    const total = boxes?.length ?? 0;
    const takenIn = boxes?.filter((b) => b.status !== "pending").length ?? 0;
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
                {error && <Alert severity="error" style={{ marginTop: "var(--space-md)" }}>{error}</Alert>}
                {boxes == null ? (
                    <div aria-busy="true" aria-label="טוען את מארזי המשלוח" style={{ marginTop: "var(--space-md)" }}>
                        <Skeleton variant="rounded" height={180} />
                    </div>
                ) : total === 0 ? (
                    !error && <Alert severity="info" style={{ marginTop: "var(--space-md)" }}>למשלוח זה לא הוצהרו מארזים להדפסה</Alert>
                ) : (
                    <>
                        <p style={{ margin: "var(--space-md) 0", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                            יודפסו {total} מדבקות — מדבקה לכל מארז, עם המזהה שלו. את המדבקה מדביקים על הקופסה, ובקליטת מארזים סורקים אותה.
                            {takenIn > 0 && ` ${takenIn === 1 ? "מארז אחד כבר נקלט" : `${takenIn} מהמארזים כבר נקלטו`} — המדבקה שלו מודפסת שוב.`}
                        </p>
                        {/* Printable area: one label per box, each on its own page/label. */}
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
                                {boxes.map((b, i) => {
                                    const { head, suffix } = fmtId(b.item_id);
                                    return (
                                        <div
                                            key={b.item_id}
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
                                            <Barcode value={barcodeOf(b.item_id, shipment?.source_id)} width={1.6} height={70} displayValue={false} margin={0} />
                                            <div style={{ marginTop: 8, textAlign: "center", direction: "rtl" }}>
                                                {/* The id reads left to right; the box's 00 stands out. */}
                                                <div dir="ltr" style={{ fontSize: 15, letterSpacing: 1.5, fontVariantNumeric: "tabular-nums" }}>
                                                    {head} <b>{suffix}</b>
                                                </div>
                                                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{b.item_type_desc}</div>
                                                <div style={{ fontSize: 13 }}>משלוח: {shipment?.shipment_code} · לקוח: {shipment?.customer_code}</div>
                                                <div style={{ fontSize: 13 }}>תאריך: {shipmentDate}</div>
                                                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>
                                                    {/* <bdi>: RTL would print label 3 of 12 as "12 / 3" */}
                                                    <bdi dir="ltr">{i + 1} / {total}</bdi>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
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
