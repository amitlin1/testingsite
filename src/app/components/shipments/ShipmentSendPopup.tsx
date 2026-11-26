"use client";
import React, { useEffect, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    DatePicker,
} from "@/components/ui";
import { Print as PrintIcon } from "@/components/ui/icons";
import { useReactToPrint } from "react-to-print";
import { useForm, Controller, useWatch } from "react-hook-form";
import { Shipment, type ShipmentSentTotal } from "@/app/lib/shipments/contract";
import { dateInputValue } from "@/app/lib/shipments/form";
import type { SentRow } from "@/app/lib/shipments/send";
import type { DirectoryWorker } from "@/lib/users/rules";
import SignatureCanvas from 'react-signature-canvas';
import { ApiError, getArray, getJson, sendJson } from "@/lib/api/client";
import { useWorkersDirectory } from "@/app/components/lookups";
import { useShipmentWorker } from "./useShipmentWorker";
import SignaturePad from "@/components/SignaturePad";
import { failureText } from "@/app/components/failureText";
import { READ_PER_VISIT } from "@/app/components/screenQuery";
import { shipmentSendsKey } from "./ShipmentHistoryPopup";
import { ShipmentDeliveryForm } from "./ShipmentDeliveryForm";
import { SHIPMENT_FORM_NO_ANSWER, WorkerField, WorkerUnknownAlert } from "./ShipmentFormFields";
import ShipmentSendLines, { blankSendLine, isSendable, type SendFormValues } from "./ShipmentSendLines";

type ShipmentSendPopupProps = {
    open: boolean;
    onClose: () => void;
    onSent: () => void;
    /** The shipments returned in one send: the row's one, or several picked above the table. */
    shipments: Shipment[];
};

const NO_WORKERS: DirectoryWorker[] = [];
const NO_SENT: SentRow[] = [];

const freshForm = (shipments: Shipment[]): SendFormValues => ({
    sent_date: dateInputValue(new Date()),
    sending_worker_id: null,
    sending_worker_name: null,
    groups: shipments.map((s) => ({ shipment_id: s.id, items: [blankSendLine()] })),
});

/** "212, 2112" — the codes of the shipments, each once, in order. */
const listOf = (values: string[]) => [...new Set(values.filter(Boolean))].join(", ");

/**
 * החזרת משלוח: boxes go back to the customer under one date, sender and
 * signature — of one shipment, or of several picked together
 * (one section of lines each, ShipmentSendLines). POST /api/shipment-history
 * records all of it in one transaction or none of it.
 */
export default function ShipmentSendPopup({
    open,
    onClose,
    onSent,
    shipments,
}: ShipmentSendPopupProps) {
    const workers = useWorkersDirectory().data ?? NO_WORKERS;
    // What already went out of each shipment, per type and makat: read on every opening. A failed
    // read keeps the last answer.
    const sentQs = useQueries({
        queries: shipments.map((s) => ({
            queryKey: [...shipmentSendsKey(s.id), "totals"],
            enabled: open,
            queryFn: () => getArray<ShipmentSentTotal>(`/api/shipment-history?shipment_id=${s.id}`),
            ...READ_PER_VISIT,
        })),
    });
    const sentOf = (i: number): SentRow[] => sentQs[i]?.data?.map((h) => ({ ...h, amount: h.total_sent })) ?? NO_SENT;
    const queryClient = useQueryClient();
    const fieldId = React.useId();
    const several = shipments.length > 1;

    const [isSigned, setIsSigned] = useState(false);

    // A refused send keeps the dialog — the typed lines and the signature —
    // open, with the reason above the buttons.
    const [submitError, setSubmitError] = useState<string | null>(null);

    // "עובד מוציא" is the logged-in worker; only a manager may pick someone
    // else (useShipmentWorker — POST /api/shipment-history applies the same rule).
    const sender = useShipmentWorker(workers);

    const {
        control,
        handleSubmit,
        reset,
        setValue,
        formState: { errors, isValid, isSubmitting },
    } = useForm<SendFormValues>({ mode: "onChange", defaultValues: freshForm(shipments) });

    const groups = useWatch({ control, name: "groups" });
    const sentDate = useWatch({ control, name: "sent_date" });

    const sigCanvas = React.useRef<SignatureCanvas>(null);

    // טופס מסירה (ShipmentDeliveryForm): printed from the form as it stands, or
    // after the send from what was sent. It counts items, so each box type's
    // contents (its template: items per box) load as the type is picked.
    // null = the type has no contents (or they failed to load).
    const [perBox, setPerBox] = useState<Record<number, number | null>>({});
    const [sent, setSent] = useState<{ date: string; itemsTotal: number | null } | null>(null);
    const printRef = React.useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: "טופס מסירת משלוח" });

    // Every opening starts clean: the screen state during render, the form in
    // the effect below.
    const [openedFor, setOpenedFor] = useState<{ open: boolean; shipments: Shipment[] } | null>(null);
    if (!openedFor || openedFor.open !== open || openedFor.shipments !== shipments) {
        setOpenedFor({ open, shipments });
        if (open && shipments.length > 0) {
            setSubmitError(null);
            setSent(null);
            // The pad mounts empty with the dialog, so the form starts unsigned
            // (as the receiving form does) — never "signed" from the last return.
            setIsSigned(false);
        }
    }
    useEffect(() => {
        if (open && shipments.length > 0) reset(freshForm(shipments));
    }, [open, shipments, reset]);

    const allLines = (groups ?? []).flatMap((g) => g.items ?? []);

    // Each picked box type's items per box, loaded once per type.
    const missingTypes = [...new Set(allLines
        .map((i) => i.item_type_id)
        .filter((id): id is number => id != null && !(id in perBox)))]
        .join(",");
    useEffect(() => {
        if (!missingTypes) return;
        let cancelled = false;
        for (const id of missingTypes.split(",").map(Number)) {
            getJson<{ lines?: { quantity?: number }[] }>(`/api/settings/item-types/${id}/contents`)
                .catch(() => null)
                .then((data) => {
                    if (cancelled) return;
                    const n = Array.isArray(data?.lines) ? data.lines.reduce((sum, l) => sum + Math.max(0, Number(l.quantity) || 0), 0) : 0;
                    setPerBox((m) => ({ ...m, [id]: n > 0 ? n : null }));
                });
        }
        return () => { cancelled = true; };
    }, [missingTypes]);

    // Declared after the reset above so it lands on the fresh form.
    useEffect(() => {
        if (!open || shipments.length === 0 || sender.selfId == null) return;
        setValue("sending_worker_id", sender.selfId);
        setValue("sending_worker_name", sender.selfName);
    }, [open, shipments, sender.selfId, sender.selfName, setValue]);

    if (shipments.length === 0) return null;

    // The items in the boxes on the form: each sendable line's boxes × its type's
    // items per box. null while a type's contents load, or when one has none.
    const sendable = allLines.filter(isSendable);
    const itemsTotal = sendable.every((i) => perBox[i.item_type_id!] != null)
        ? sendable.reduce((n, i) => n + Number(i.amount) * (perBox[i.item_type_id!] ?? 0), 0)
        : null;

    const onSubmit = async (data: SendFormValues) => {
        setSubmitError(null);
        // The dialog closes only once the server has accepted the return; a
        // refusal keeps the typed lines and the signature, with the reason shown.
        const sends = data.groups.map((g) => ({ shipment_id: g.shipment_id, items: g.items.filter(isSendable) }));
        if (sends.some((s) => s.items.length === 0)) {
            setSubmitError(several ? "יש להוסיף לכל משלוח לפחות סוג מארז אחד לשליחה." : "יש להוסיף לפחות סוג מארז אחד לשליחה.");
            return;
        }
        try {
            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;
            await sendJson("/api/shipment-history", "POST", {
                sent_date: new Date(data.sent_date).toISOString(),
                sending_worker_id: data.sending_worker_id,
                sending_worker_name: data.sending_worker_name,
                shipments: sends,
                signature_base64,
            });
        } catch (error) {
            console.error(error instanceof ApiError ? "Failed to send shipment items" : error);
            setSubmitError(failureText(error, "המשלוח לא נשלח. בדוק את הכמויות ונסה שוב.", SHIPMENT_FORM_NO_ANSWER));
            return;
        }
        for (const s of sends) void queryClient.invalidateQueries({ queryKey: shipmentSendsKey(s.shipment_id) });
        setSent({ date: data.sent_date, itemsTotal });
        // The dialog stays open, to offer the delivery form for what was sent.
        onSent();
    };

    const typeDesc = (typeId: number) =>
        shipments.flatMap((s) => s.shipment_items ?? []).find((o) => o.item_type_id === typeId)?.item_type_desc || "סוג מארז";
    const noContents = [...new Set(sendable
        .filter((i) => i.item_type_id! in perBox && perBox[i.item_type_id!] == null)
        .map((i) => typeDesc(i.item_type_id!)))];

    // What still keeps "שלח" disabled, said next to it — a field turns red only
    // once touched, so an untouched empty one left the button dead with no reason.
    const amountErrors = errors.groups?.some?.((g) => g?.items?.some?.((e) => e?.amount));
    const groupsWithoutLine = (groups ?? [])
        .map((g, i) => (g.items ?? []).some(isSendable) ? null : shipments[i]?.shipment_code)
        .filter((code): code is string => !!code);
    const printBlocked = !sentDate ? "יש למלא תאריך שליחה"
        : groupsWithoutLine.length > 0 || amountErrors ? "יש למלא כמות מארזים תקינה"
        : noContents.length > 0 ? `אין תבנית תכולה ל${noContents.join(", ")}, ולכן אי אפשר לספור פריטים`
        : itemsTotal == null ? "טוען את תכולת המארזים…"
        : null;
    const printForm = sent ?? { date: sentDate ?? "", itemsTotal };

    const missing = [
        !sentDate && "תאריך שליחה",
        allLines.some((i) => !i.item_type_id) && "סוג מארז",
        groupsWithoutLine.length > 0 && (several ? `כמות מארזים (${groupsWithoutLine.join(", ")})` : "כמות מארזים"),
        amountErrors && "כמות תקינה (עד המקסימום)",
        !isSigned && "חתימה",
    ].filter(Boolean) as string[];

    const sourceCodes = listOf(shipments.map((s) => s.shipment_code));
    const customerCodes = listOf(shipments.map((s) => s.customer_code));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle onClose={onClose}>
                {several ? `החזרת ${shipments.length} משלוחים` : "החזרת משלוח"}
            </DialogTitle>
            {/* What the printer gets; on screen it stays hidden. */}
            <div style={{ display: "none" }}>
                {printForm.itemsTotal != null && (
                    <ShipmentDeliveryForm
                        ref={printRef}
                        sentDate={printForm.date}
                        sourceShipmentCode={sourceCodes}
                        customerCode={customerCodes}
                        itemsTotal={printForm.itemsTotal}
                    />
                )}
            </div>
            {sent ? (
                <>
                    <DialogContent>
                        <Alert severity="success">
                            {several ? `${shipments.length} המשלוחים נשלחו.` : `המשלוח ${shipments[0].shipment_code} נשלח.`}
                            {" "}אפשר להדפיס עכשיו את טופס המסירה, עם מקום לחתימת המקבל.
                        </Alert>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={onClose} variant="outlined" color="inherit">
                            סגירה
                        </Button>
                        <Button
                            variant="contained"
                            startIcon={<PrintIcon fontSize={16} aria-hidden />}
                            disabled={sent.itemsTotal == null}
                            title={sent.itemsTotal == null ? "אי אפשר לספור את הפריטים במארזים שנשלחו" : undefined}
                            onClick={() => handlePrint()}
                        >
                            הדפס טופס מסירה
                        </Button>
                    </DialogActions>
                </>
            ) : (
            <form onSubmit={(e) => handleSubmit(onSubmit)(e)} noValidate style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                <DialogContent>
                    {sender.blocked && <WorkerUnknownAlert />}
                    <Alert severity="info" sx={{ mb: 2 }}>
                        הכמויות הן מספר מארזים. לכל סוג מארז אפשר לשלוח עד הכמות שהוצהרה פחות מה שכבר נשלח.
                    </Alert>
                    <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
                        {several ? "משלוחי מקור" : "משלוח מקור"}: <strong style={{ color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{sourceCodes}</strong>
                        {" · "}
                        {several && customerCodes.includes(",") ? "לקוחות" : "לקוח"}: <strong style={{ color: "var(--color-ink)" }}>{customerCodes}</strong>
                    </p>
                    <div className="shp-form-grid">
                        <Controller
                            name="sent_date"
                            control={control}
                            rules={{ required: "שדה חובה" }}
                            render={({ field }) => (
                                <DatePicker
                                    id={`${fieldId}-date`}
                                    label="תאריך שליחה"
                                    required
                                    value={field.value}
                                    onChange={field.onChange}
                                    error={errors.sent_date?.message}
                                />
                            )}
                        />

                        <Controller
                            name="sending_worker_id"
                            control={control}
                            render={({ field: { onChange, value } }) => (
                                <WorkerField
                                    label="עובד מוציא"
                                    options={sender.options}
                                    workers={workers}
                                    value={value}
                                    onChange={(worker) => {
                                        onChange(worker?.worker_id ?? null);
                                        setValue("sending_worker_name", worker?.worker_name ?? null);
                                    }}
                                    locked={sender.locked}
                                    helper={sender.locked && !sender.blocked ? "מזוהה מההתחברות" : null}
                                />
                            )}
                        />
                    </div>

                    {/* One section per source shipment; the groups match `shipments` by index (freshForm). */}
                    {shipments.map((s, i) => (
                        <div key={s.id} style={{ marginTop: "var(--space-lg)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
                            <ShipmentSendLines control={control} index={i} shipment={s} sent={sentOf(i)} titled={several} />
                        </div>
                    ))}

                    {/* Signature — required to send (the button waits for it), and
                        now it says so, the same way the receiving form does. */}
                    <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)" }}>
                        <SignaturePad
                            canvasRef={sigCanvas}
                            signed={isSigned}
                            onSignedChange={setIsSigned}
                            hint="יש לחתום לפני השליחה"
                        />
                    </div>

                </DialogContent>
                {submitError && (
                    <div style={{ padding: "0 var(--space-lg) var(--space-sm)" }}>
                        <Alert severity="error">{submitError}</Alert>
                    </div>
                )}
                <DialogActions>
                    {missing.length > 0 && !sender.blocked && (
                        <span className="sh-field-helper" role="status" style={{ marginInlineEnd: "auto", marginTop: 0 }}>
                            חסר לשליחה: {missing.join(" · ")}
                        </span>
                    )}
                    <Button onClick={onClose} variant="outlined" color="inherit">
                        ביטול
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<PrintIcon fontSize={16} aria-hidden />}
                        disabled={printBlocked != null}
                        title={printBlocked ?? undefined}
                        onClick={() => handlePrint()}
                    >
                        הדפס טופס מסירה
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isValid || !isSigned || groupsWithoutLine.length > 0 || sender.blocked}
                        loading={isSubmitting}
                        variant="contained"
                    >
                        שלח
                    </Button>
                </DialogActions>
            </form>
            )}
        </Dialog>
    );
}
