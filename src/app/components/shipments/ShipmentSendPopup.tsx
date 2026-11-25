"use client";
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    IconButton,
    Alert,
    SearchableCombobox,
    FieldLabel,
} from "@/components/ui";
import { Add as AddIcon, Delete as DeleteIcon, Print as PrintIcon } from "@/components/ui/icons";
import { useReactToPrint } from "react-to-print";
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { Shipment, type ShipmentSentTotal } from "@/app/lib/shipments/contract";
import { dateInputValue } from "@/app/lib/shipments/form";
import { declaredLineOf, maxToSend, type SentRow } from "@/app/lib/shipments/send";
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

type ShipmentSendPopupProps = {
    open: boolean;
    onClose: () => void;
    onSent: () => void;
    shipment: Shipment | null;
};

type SendFormValues = {
    sent_shipment_code: string;
    /** YYYY-MM-DD, as the date input holds it. */
    sent_date: string;
    sending_worker_id: number | null;
    sending_worker_name: string | null;
    items: {
        item_type_id: number | null;
        makat: string | null;
        amount: number | '';
    }[];
};

const NO_WORKERS: DirectoryWorker[] = [];

export default function ShipmentSendPopup({
    open,
    onClose,
    onSent,
    shipment,
}: ShipmentSendPopupProps) {
    const workers = useWorkersDirectory().data ?? NO_WORKERS;
    // What already went out, per type and makat: read on every opening. A failed read keeps the
    // last answer.
    const sentQ = useQuery({
        queryKey: [...shipmentSendsKey(shipment?.id), "totals"],
        enabled: open && shipment?.id != null,
        queryFn: () => getArray<ShipmentSentTotal>(`/api/shipment-history?shipment_id=${shipment!.id}`),
        ...READ_PER_VISIT,
    });
    const history = React.useMemo<SentRow[]>(() => (sentQ.data ?? []).map((h) => ({ ...h, amount: h.total_sent })), [sentQ.data]);
    const queryClient = useQueryClient();
    const fieldId = React.useId();

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
    } = useForm<SendFormValues>({
        mode: "onChange",
        defaultValues: {
            sent_shipment_code: "",
            sent_date: dateInputValue(new Date()),
            sending_worker_id: null,
            sending_worker_name: null,
            items: [{ item_type_id: null, makat: null, amount: '' }],
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "items"
    });

    const items = useWatch({ control, name: "items" });
    const sentCode = useWatch({ control, name: "sent_shipment_code" });
    const sentDate = useWatch({ control, name: "sent_date" });

    const sigCanvas = React.useRef<SignatureCanvas>(null);

    // טופס מסירה (ShipmentDeliveryForm): printed from the form as it stands, or
    // after the send from what was sent. It counts items, so each box type's
    // contents (its template: items per box) load as the type is picked.
    // null = the type has no contents (or they failed to load).
    const [perBox, setPerBox] = useState<Record<number, number | null>>({});
    const [sent, setSent] = useState<{ code: string; date: string; itemsTotal: number | null } | null>(null);
    const printRef = React.useRef<HTMLDivElement>(null);
    const handlePrint = useReactToPrint({ contentRef: printRef, documentTitle: "טופס מסירת משלוח" });

    // Every opening starts clean: the screen state during render, the form in
    // the effect below.
    const [openedFor, setOpenedFor] = useState<{ open: boolean; shipment: typeof shipment } | null>(null);
    if (!openedFor || openedFor.open !== open || openedFor.shipment !== shipment) {
        setOpenedFor({ open, shipment });
        if (open && shipment) {
            setSubmitError(null);
            setSent(null);
            // The pad mounts empty with the dialog, so the form starts unsigned
            // (as the receiving form does) — never "signed" from the last return.
            setIsSigned(false);
        }
    }
    useEffect(() => {
        if (open && shipment) {
            reset({
                sent_shipment_code: "",
                sent_date: dateInputValue(new Date()),
                sending_worker_id: null,
                sending_worker_name: null,
                items: [{ item_type_id: null, makat: null, amount: '' }],
            });
        }
    }, [open, shipment, reset]);

    // Each picked box type's items per box, loaded once per type.
    const missingTypes = (items ?? [])
        .map((i) => i.item_type_id)
        .filter((id): id is number => id != null && !(id in perBox))
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
        if (!open || !shipment || sender.selfId == null) return;
        setValue("sending_worker_id", sender.selfId);
        setValue("sending_worker_name", sender.selfName);
    }, [open, shipment, sender.selfId, sender.selfName, setValue]);

    const onSubmit = async (data: SendFormValues) => {
        if (!shipment) return;
        setSubmitError(null);
        // The dialog closes only once the server has accepted the return; a
        // refusal keeps the typed lines and the signature, with the reason shown.
        const validItems = data.items.filter(i => i.item_type_id && Number(i.amount) > 0);
        if (validItems.length === 0) {
            setSubmitError("יש להוסיף לפחות סוג מארז אחד לשליחה.");
            return;
        }
        try {
            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;
            await sendJson("/api/shipment-history", "POST", {
                shipment_id: shipment.id,
                sent_shipment_code: data.sent_shipment_code,
                sent_date: new Date(data.sent_date).toISOString(),
                sending_worker_id: data.sending_worker_id,
                sending_worker_name: data.sending_worker_name,
                items: validItems,
                signature_base64
            });
        } catch (error) {
            console.error(error instanceof ApiError ? "Failed to send shipment items" : error);
            setSubmitError(failureText(error, "המשלוח לא נשלח. בדוק את הכמויות ונסה שוב.", SHIPMENT_FORM_NO_ANSWER));
            return;
        }
        void queryClient.invalidateQueries({ queryKey: shipmentSendsKey(shipment.id) });
        setSent({ code: data.sent_shipment_code, date: data.sent_date, itemsTotal });
        // The dialog stays open, to offer the delivery form for what was sent.
        onSent();
    };

    if (!shipment) return null;

    const availableItems = shipment.shipment_items || [];

    // The send counts boxes as declared, not as tested: say what is still not
    // done before the shipment is closed by it.
    const notTakenIn = Math.max(0, (shipment.total_items ?? 0) - (shipment.sampled_amount ?? 0));
    const unfinished = Math.max(0, (shipment.sampled_amount ?? 0) - (shipment.finished_sampled_amount ?? 0));

    // What still keeps "שלח" disabled, said next to it — a field turns red only
    // once touched, so an untouched empty one left the button dead with no reason.
    const lines = items ?? [];
    const hasSendableLine = lines.some((i) => i.item_type_id && Number(i.amount) > 0);
    // The items in the boxes on the form: each sendable line's boxes × its type's
    // items per box. null while a type's contents load, or when one has none.
    const sendable = lines.filter((i) => i.item_type_id && Number(i.amount) > 0);
    const itemsTotal = sendable.every((i) => perBox[i.item_type_id!] != null)
        ? sendable.reduce((n, i) => n + Number(i.amount) * (perBox[i.item_type_id!] ?? 0), 0)
        : null;
    const noContents = sendable
        .filter((i) => i.item_type_id! in perBox && perBox[i.item_type_id!] == null)
        .map((i) => availableItems.find((o) => o.item_type_id === i.item_type_id)?.item_type_desc || "סוג מארז");
    const printBlocked = !sentCode?.trim() ? "יש למלא קוד משלוח יוצא"
        : !sentDate ? "יש למלא תאריך שליחה"
        : !hasSendableLine || errors.items?.some?.((e) => e?.amount) ? "יש למלא כמות מארזים תקינה"
        : noContents.length > 0 ? `אין תבנית תכולה ל${noContents.join(", ")}, ולכן אי אפשר לספור פריטים`
        : itemsTotal == null ? "טוען את תכולת המארזים…"
        : null;
    const printForm = sent ?? { code: sentCode ?? "", date: sentDate ?? "", itemsTotal };

    const missing = [
        !sentCode?.trim() && "קוד משלוח יוצא",
        !sentDate && "תאריך שליחה",
        lines.some((i) => !i.item_type_id) && "סוג מארז",
        !hasSendableLine && "כמות מארזים",
        errors.items?.some?.((e) => e?.amount) && "כמות תקינה (עד המקסימום)",
        !isSigned && "חתימה",
    ].filter(Boolean) as string[];

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle onClose={onClose}>
                החזרת משלוח
            </DialogTitle>
            {/* What the printer gets; on screen it stays hidden. */}
            <div style={{ display: "none" }}>
                {printForm.itemsTotal != null && (
                    <ShipmentDeliveryForm
                        ref={printRef}
                        sentCode={printForm.code}
                        sentDate={printForm.date}
                        sourceShipmentCode={shipment.shipment_code}
                        customerCode={shipment.customer_code}
                        itemsTotal={printForm.itemsTotal}
                    />
                )}
            </div>
            {sent ? (
                <>
                    <DialogContent>
                        <Alert severity="success">
                            המשלוח {sent.code} נשלח. אפשר להדפיס עכשיו את טופס המסירה, עם מקום לחתימת המקבל.
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
                    {(notTakenIn > 0 || unfinished > 0) && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            {[
                                notTakenIn > 0 ? (notTakenIn === 1 ? "מארז אחד לא נקלט" : `${notTakenIn} מארזים לא נקלטו`) : null,
                                unfinished > 0 ? (unfinished === 1 ? "מארז אחד עדיין בבדיקה" : `${unfinished} מארזים עדיין בבדיקה`) : null,
                            ].filter(Boolean).join(" · ")}
                            . שליחה שמשלימה את הכמות שהוצהרה סוגרת את המשלוח, והמארזים שלא נקלטו נמחקים איתה.
                        </Alert>
                    )}
                    <p style={{ margin: "0 0 var(--space-md)", fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-70)" }}>
                        משלוח מקור: <strong style={{ color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{shipment.shipment_code}</strong>
                        {" · "}
                        לקוח: <strong style={{ color: "var(--color-ink)" }}>{shipment.customer_code}</strong>
                    </p>
                    <div className="shp-form-grid shp-form-grid--3">
                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-code`}>קוד משלוח יוצא</FieldLabel>
                            <Controller
                                name="sent_shipment_code"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${fieldId}-code`}
                                        placeholder="קוד משלוח יוצא"
                                        fullWidth
                                        size="small"
                                        error={!!errors.sent_shipment_code}
                                        helperText={errors.sent_shipment_code?.message}
                                        // A code reads left to right; aligned with the Hebrew fields.
                                        inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
                                    />
                                )}
                            />
                        </div>

                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-date`}>תאריך שליחה</FieldLabel>
                            <Controller
                                name="sent_date"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${fieldId}-date`}
                                        type="date"
                                        fullWidth
                                        size="small"
                                        error={!!errors.sent_date}
                                        helperText={errors.sent_date?.message}
                                    />
                                )}
                            />
                        </div>

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

                    <div style={{ marginTop: "var(--space-lg)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
                            <div style={{ fontSize: "var(--text-body)", fontWeight: 600 }}>מארזים לשליחה</div>
                            <Button variant="outlined" size="small" startIcon={<AddIcon fontSize={16} aria-hidden />} onClick={() => append({ item_type_id: null, makat: null, amount: '' })}>
                                הוסף סוג מארז לשליחה
                            </Button>
                        </div>
                        <div className="shp-items-head shp-items-row--wide" aria-hidden>
                            <span>סוג מארז</span>
                            <span>מארזים</span>
                            <span />
                        </div>
                        {fields.map((item, index) => (
                            // One line: type, amount, delete — tops aligned so the amount's
                            // note / error underneath doesn't push the line out of shape.
                            <div key={item.id} className="shp-items-row shp-items-row--wide">
                                <Controller
                                    name={`items.${index}` as const}
                                    control={control}
                                    rules={{
                                        validate: (val) => val.item_type_id ? true : "בחר סוג מארז"
                                    }}
                                    render={({ field: { onChange, value } }) => (
                                        <SearchableCombobox<(typeof availableItems)[number]>
                                            options={availableItems}
                                            getOptionLabel={(option) =>
                                                `${option.item_type_desc || '—'}`
                                            }
                                            value={declaredLineOf(availableItems, value.item_type_id, value.makat) || null}
                                            onChange={(newValue) => {
                                                if (newValue) {
                                                    onChange({
                                                        item_type_id: newValue.item_type_id,
                                                        makat: newValue.makat || null,
                                                        amount: value.amount,
                                                    });
                                                } else {
                                                    onChange({ item_type_id: null, makat: null, amount: '' });
                                                }
                                            }}
                                            placeholder="סוג מארז"
                                            error={!!errors.items?.[index]}
                                        />
                                    )}
                                />

                                <Controller
                                    name={`items.${index}.amount` as const}
                                    control={control}
                                    rules={{
                                        validate: (value, formValues) => {
                                            if (value === '' || value === 0) return true;
                                            const currentItem = formValues.items[index];
                                            if (!currentItem.item_type_id) return true;
                                            const maxAllowed = maxToSend(availableItems, history, currentItem.item_type_id, currentItem.makat);
                                            if (Number(value) > maxAllowed) {
                                                return `המקסימום לשליחה הוא ${maxAllowed}`;
                                            }
                                            return true;
                                        }
                                    }}
                                    render={({ field }) => {
                                        // Right after "הוסף" the watched list is a render
                                        // behind the rows: the new row starts blank.
                                        const currentItem = items?.[index] ?? item;
                                        const maxAllowed = maxToSend(availableItems, history, currentItem.item_type_id, currentItem.makat);

                                        return (
                                            <TextField
                                                {...field}
                                                placeholder="מארזים"
                                                type="number"
                                                required
                                                size="small"
                                                fullWidth
                                                inputProps={{ "aria-label": `מארזים לשליחה, שורה ${index + 1}`, style: { fontVariantNumeric: "tabular-nums" } }}
                                                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                                error={!!errors.items?.[index]?.amount}
                                                helperText={errors.items?.[index]?.amount ? (errors.items[index]?.amount?.message || "כמות לא תקינה") : `מקס׳ ${maxAllowed}`}
                                            />
                                        );
                                    }}
                                />
                                <IconButton size="small" color="error" title="הסר שורה" onClick={() => remove(index)}>
                                    <DeleteIcon fontSize={16} aria-hidden />
                                </IconButton>
                            </div>
                        ))}
                    </div>

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
                        disabled={!isValid || !isSigned || !hasSendableLine || sender.blocked}
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
