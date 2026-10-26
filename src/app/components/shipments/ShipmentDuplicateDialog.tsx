"use client";
import React from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert } from "@/components/ui";
import { formatDate } from "@/app/lib/datetime";

/** The shipment already in the system with the same number and customer —
 *  what the server's SHIPMENT_DUPLICATE refusal carries in `existing`. */
export type DuplicateShipment = {
    shipment_code: string;
    customer_code: string | null;
    shipment_date: string | null;
    received_at?: string | null;
    amount?: number | null;
};

/**
 * The same certificate (number + customer) was already entered. Usually a
 * second scan of it — but a shipment can come again on the same
 * certificate, so the worker may still enter it, knowingly.
 */
export default function ShipmentDuplicateDialog({
    duplicate,
    onCancel,
    onConfirm,
}: {
    duplicate: DuplicateShipment | null;
    onCancel: () => void;
    /** "הכנס בכל זאת": go on with this shipment as a new one. */
    onConfirm: () => void;
}) {
    const received = duplicate?.received_at ?? duplicate?.shipment_date ?? null;
    return (
        <Dialog open={!!duplicate} onClose={onCancel} fullWidth maxWidth="xs">
            <DialogTitle onClose={onCancel}>המשלוח כבר קיים במערכת</DialogTitle>
            <DialogContent>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                    <Alert severity="warning">
                        משלוח עם אותו מספר ואותו לקוח כבר נקלט. אם התעודה נסרקה שוב בטעות — בטל. אם זה באמת משלוח נוסף עם אותה תעודה, אפשר להכניס אותו שוב.
                    </Alert>
                    {duplicate && (
                        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: "var(--text-body-sm)" }}>
                            <dt style={{ color: "var(--color-ink-muted-48)" }}>מס׳ משלוח</dt>
                            <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{duplicate.shipment_code}</dd>
                            <dt style={{ color: "var(--color-ink-muted-48)" }}>קוד לקוח</dt>
                            <dd style={{ margin: 0, fontWeight: 600 }}>{duplicate.customer_code ?? "—"}</dd>
                            <dt style={{ color: "var(--color-ink-muted-48)" }}>תאריך קבלה</dt>
                            <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{received ? formatDate(received) : "—"}</dd>
                            {duplicate.amount != null && (
                                <>
                                    <dt style={{ color: "var(--color-ink-muted-48)" }}>מארזים</dt>
                                    <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{duplicate.amount}</dd>
                                </>
                            )}
                        </dl>
                    )}
                </div>
            </DialogContent>
            <DialogActions>
                <Button variant="outlined" color="inherit" onClick={onConfirm}>הכנס בכל זאת</Button>
                <Button variant="contained" onClick={onCancel}>ביטול</Button>
            </DialogActions>
        </Dialog>
    );
}

/** The server's duplicate refusal, read off a failed save; null for any other. */
export async function duplicateOf(res: Response): Promise<DuplicateShipment | null> {
    if (res.status !== 409) return null;
    const body = await res.clone().json().catch(() => null);
    return body?.code === "SHIPMENT_DUPLICATE" && body.existing ? (body.existing as DuplicateShipment) : null;
}
