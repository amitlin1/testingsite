"use client";
import React, { useState } from "react";
import { ConfirmDialog, useToast } from "@/components/ui";
import type { Shipment } from "@/app/lib/shipments/contract";
import { shipmentDeleteRule } from "@/app/lib/shipments/delete";
import { NO_CONNECTION_TEXT, failureText } from "@/app/components/failureText";
import { sendJson } from "@/lib/api/client";

type Props = {
    /** The shipment to delete; null = closed. */
    shipment: Shipment | null;
    /** May this user delete a shipment whose boxes were taken in (ACCESS.deleteTakenInShipment)? */
    canDeleteTakenIn: boolean;
    onClose: () => void;
    onDeleted: () => void;
};

/**
 * The shipment delete's confirmation (DELETE /api/shipments/[id]): the worker
 * types the shipment's number before the delete is enabled. When boxes were
 * already taken in (a manager only — lib/shipments/delete.ts), it says what
 * goes with them and asks the server for exactly that (`with_taken_in`).
 */
export default function ShipmentDeleteDialog({ shipment, canDeleteTakenIn, onClose, onDeleted }: Props) {
    const toast = useToast();
    const [deleting, setDeleting] = useState(false);
    const rule = shipment ? shipmentDeleteRule(shipment, canDeleteTakenIn) : null;
    const withTakenIn = rule?.kind === "withTakenIn";

    const handleDelete = async () => {
        if (!shipment) return;
        setDeleting(true);
        try {
            await sendJson(`/api/shipments/${shipment.id}`, "DELETE", withTakenIn ? { with_taken_in: true } : undefined);
            toast.show(`משלוח ${shipment.shipment_code} נמחק`, "success");
            onDeleted();
        } catch (error) {
            toast.show(failureText(error, "שגיאה במחיקת המשלוח", NO_CONNECTION_TEXT), "error");
        } finally {
            setDeleting(false);
        }
    };

    const message = !shipment ? "" : rule?.kind === "withTakenIn" ? (
        <>
            ממשלוח <strong>{shipment.shipment_code}</strong> כבר {rule.takenIn === 1 ? "נקלט מארז אחד" : `נקלטו ${rule.takenIn} מארזים`}.
            <br />
            המחיקה תמחק גם אותם, את הפריטים שבתוכם ואת כל הבדיקות, התוצאות והדוחות שנרשמו עליהם.
            <br />
            <strong>פעולה זו אינה ניתנת לביטול.</strong>
        </>
    ) : `האם למחוק את משלוח ${shipment.shipment_code}? פעולה זו אינה ניתנת לביטול.`;

    return (
        <ConfirmDialog
            open={shipment != null}
            title={withTakenIn ? "מחיקת משלוח עם מארזים שנקלטו" : "מחיקת משלוח"}
            message={message}
            confirmText={withTakenIn ? "מחק משלוח ומארזים" : "מחק משלוח"}
            destructive
            busy={deleting}
            confirmPhrase={shipment?.shipment_code}
            confirmPhraseLabel={shipment ? <>לאישור המחיקה יש להקליד את מספר המשלוח <strong>{shipment.shipment_code}</strong></> : undefined}
            onConfirm={handleDelete}
            onCancel={onClose}
        />
    );
}
