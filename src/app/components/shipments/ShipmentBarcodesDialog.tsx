"use client";
import React, { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    Skeleton,
} from "@/components/ui";
import { useReactToPrint } from "react-to-print";
import { Print as PrintIcon } from "@/components/ui/icons";
import { Shipment } from "@/app/lib/shipments/contract";
import { sendJson } from "@/lib/api/client";
import { NO_CONNECTION_TEXT, failureText } from "@/app/components/failureText";
import { READ_PER_VISIT } from "@/app/components/screenQuery";
import type { PackageView } from "@/app/lib/packages/contract";
import { ShipmentBoxLabel } from "@/app/components/labels/Labels";

type ShipmentBarcodesDialogProps = {
    open: boolean;
    onClose: () => void;
    shipment: Shipment | null;
};

/**
 * One label per BOX of the shipment, each with the box's own id (ending in
 * 00, lib/packages/ids.ts) as its barcode — the label the intake scans. A label carries
 * the code only: the barcode and its digits, no text. The boxes are
 * minted when the shipment is saved (lib/packages/boxes.ts); opening this
 * asks the server for them, which also mints the missing ones of a shipment
 * saved before that. Item labels print later, at the opening station.
 */
export default function ShipmentBarcodesDialog({ open, onClose, shipment }: ShipmentBarcodesDialogProps) {
    const printRef = useRef<HTMLDivElement>(null);
    const shipmentId = shipment?.id ?? null;
    // Asked on every opening (the POST also mints what is missing).
    const boxesQ = useQuery({
        queryKey: ["shipment-boxes", shipmentId],
        enabled: open && shipmentId != null,
        queryFn: async () => (await sendJson<{ boxes: PackageView[] }>(`/api/shipments/${shipmentId}/boxes`, "POST")).boxes,
        ...READ_PER_VISIT,
    });
    const settled = !boxesQ.isFetching;
    const error = settled && boxesQ.isError ? failureText(boxesQ.error, "טעינת מארזי המשלוח נכשלה", NO_CONNECTION_TEXT) : null;
    const boxes: PackageView[] | null = !settled ? null : error ? [] : boxesQ.data ?? null;

    const total = boxes?.length ?? 0;
    const takenIn = boxes?.filter((b) => b.status !== "pending").length ?? 0;

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
                            יודפסו {total} מדבקות — מדבקה לכל מארז, עם המזהה שלו. את המדבקה מדביקים על הקופסה של השורה שעליה (לפי הסריאלי או המק״ט בתעודה), ובקליטת מארזים סורקים אותה.
                            {takenIn > 0 && ` ${takenIn === 1 ? "מארז אחד כבר נקלט" : `${takenIn} מהמארזים כבר נקלטו`} — המדבקה שלו מודפסת שוב.`}
                        </p>
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
                                {boxes.map((b) => <ShipmentBoxLabel key={b.item_id} id={b.item_id} />)}
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
