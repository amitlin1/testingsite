"use client";
import React, { useEffect, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    IconButton,
    Alert,
} from "@/components/ui";
import { Add as AddIcon, Delete as DeleteIcon } from "@/components/ui/icons";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Shipment } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";
import SignatureCanvas from 'react-signature-canvas';
import { apiFetch } from "@/lib/api/client";
import { useShipmentWorker } from "@/lib/hooks/useShipmentWorker";
import ShipmentSignatureField from "./ShipmentSignatureField";
import { serverErrorMessage, NETWORK_ERROR } from "./serverError";

type ShipmentSendPopupProps = {
    open: boolean;
    onClose: () => void;
    onSend: (success: boolean) => void;
    shipment: Shipment | null;
};

type SendFormValues = {
    sent_shipment_code: string;
    sent_date: string; // ISO date string YYYY-MM-DD
    sending_worker_id: number | null;
    sending_worker_name: string | null;
    items: {
        item_type_id: number | null;
        makat: number | null;
        amount: number | '';
        // Helper to store the original index or id to lookup details if needed
        original_item_index?: number;
    }[];
};

export default function ShipmentSendPopup({
    open,
    onClose,
    onSend,
    shipment,
}: ShipmentSendPopupProps) {
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string; roles: string[] }[]>([]);
    const [history, setHistory] = useState<{ item_type_id: number; makat: number | null; total_sent: number }[]>([]);
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
        watch,
        setValue,
        formState: { errors, isValid, isSubmitting },
    } = useForm<SendFormValues>({
        mode: "onChange",
        defaultValues: {
            sent_shipment_code: "",
            sent_date: new Date().toISOString().split("T")[0],
            sending_worker_id: null,
            sending_worker_name: null,
            items: [{ item_type_id: null, makat: null, amount: '' }],
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "items"
    });

    const items = watch("items");

    const sigCanvas = React.useRef<SignatureCanvas>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch("/api/workers-directory");
                const data = await res.json();
                if (!cancelled && Array.isArray(data)) {
                    setWorkers(data);
                }
            } catch (err) {
                console.error("Error loading workers:", err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (shipment?.id) {
            apiFetch(`/api/shipment-history?shipment_id=${shipment.id}`)
                .then(res => res.json())
                .then(data => {
                    if (Array.isArray(data)) {
                        setHistory(data);
                    }
                })
                .catch(err => console.error("Error loading history:", err));
        } else {
            setHistory([]);
        }
    }, [shipment]);

    useEffect(() => {
        if (open && shipment) {
            reset({
                sent_shipment_code: "",
                sent_date: new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE }),
                sending_worker_id: null,
                sending_worker_name: null,
                items: [{ item_type_id: null, makat: null, amount: '' }],
            });
            setSubmitError(null);
            // The pad mounts empty with the dialog, so the form starts unsigned
            // (as the receiving form does) — never "signed" from the last return.
            setIsSigned(false);
        }
    }, [open, shipment, reset]);

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
        let saved = false;

        try {
            // Filter valid items
            const validItems = data.items.filter(i => i.item_type_id && Number(i.amount) > 0);
            if (validItems.length === 0) {
                setSubmitError("יש להוסיף לפחות סוג מארז אחד לשליחה.");
                return;
            }



            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;

            const payload = {
                shipment_id: shipment.id,
                sent_shipment_code: data.sent_shipment_code,
                sent_date: new Date(data.sent_date).toISOString(),
                sending_worker_id: data.sending_worker_id,
                sending_worker_name: data.sending_worker_name,
                items: validItems,
                signature_base64
            };

            const res = await apiFetch("/api/shipment-history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                saved = true;
            } else {
                console.error("Failed to send shipment items");
                setSubmitError(await serverErrorMessage(res, "המשלוח לא נשלח. בדוק את הכמויות ונסה שוב."));
            }
        } catch (error) {
            console.error(error);
            setSubmitError(NETWORK_ERROR);
        } finally {
            if (saved) {
                onSend(true);
                onClose();
            }
        }
    };

    if (!shipment) return null;

    // Available items options from the shipment
    const availableItems = shipment.shipment_items || [];

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
            <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                <DialogContent>
                    {sender.blocked && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו בהגדרות משתמשים.
                        </Alert>
                    )}
                    <Alert severity="info" sx={{ mb: 2 }}>
                        הכמויות הן מספר מארזים. לכל סוג מארז אפשר לשלוח עד הכמות שהוצהרה פחות מה שכבר נשלח.
                    </Alert>
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

                        <div>
                            <Controller
                                name="sending_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ worker_id: number; worker_name: string; roles: string[] }>
                                        label="עובד מוציא"
                                        options={sender.options}
                                        getOptionLabel={(option) => option.worker_name}
                                        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(newValue) => {
                                            onChange(newValue?.worker_id ?? null);
                                            setValue("sending_worker_name", newValue?.worker_name ?? null);
                                        }}
                                        disabled={sender.locked}
                                        placeholder={sender.locked ? "מזוהה מההתחברות" : "בחר עובד…"}
                                        error={!!errors.sending_worker_id}
                                    />
                                )}
                            />
                            {sender.locked && !sender.blocked && <div className="sh-field-helper">מזוהה מההתחברות</div>}
                        </div>
                    </div>

                    {/* Dynamic Items Selection */}
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
                                            // Find the matching option based on item_type_id and makat
                                            value={availableItems.find(opt =>
                                                opt.item_type_id === value.item_type_id && opt.makat == value.makat
                                            ) || null}
                                            onChange={(newValue) => {
                                                if (newValue) {
                                                    onChange({
                                                        item_type_id: newValue.item_type_id,
                                                        makat: newValue.makat || null,
                                                        amount: value.amount // Keep typed amount or reset? User didn't specify. Keeping it is safer unless we change item.
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
                                            // Allow empty or 0 during input
                                            if (value === '' || value === 0) return true;

                                            const currentItem = formValues.items[index];
                                            if (!currentItem.item_type_id) return true; // Skip if no item selected yet

                                            const originalItem = availableItems.find(opt =>
                                                opt.item_type_id === currentItem.item_type_id && opt.makat == currentItem.makat
                                            );
                                            const totalReceived = originalItem ? originalItem.quantity : 0;

                                            const sentItem = history.find(h =>
                                                h.item_type_id === currentItem.item_type_id && h.makat == currentItem.makat
                                            );
                                            const previouslySent = sentItem ? sentItem.total_sent : 0;
                                            const maxAllowed = Math.max(0, totalReceived - previouslySent);

                                            if (Number(value) > maxAllowed) {
                                                return `המקסימום לשליחה הוא ${maxAllowed}`;
                                            }
                                            return true;
                                        }
                                    }}
                                    render={({ field }) => {
                                        // Calculate max allowed
                                        const currentItem = items[index];
                                        const originalItem = availableItems.find(opt =>
                                            opt.item_type_id === currentItem.item_type_id && opt.makat == currentItem.makat
                                        );
                                        const totalReceived = originalItem ? originalItem.quantity : 0;

                                        const sentItem = history.find(h =>
                                            h.item_type_id === currentItem.item_type_id && h.makat == currentItem.makat
                                        );
                                        const previouslySent = sentItem ? sentItem.total_sent : 0;
                                        const maxAllowed = Math.max(0, totalReceived - previouslySent);

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
                        <ShipmentSignatureField
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
                    <Button onClick={onClose} variant="outlined" color="inherit">
                        ביטול
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isValid || !isSigned || sender.blocked}
                        loading={isSubmitting}
                        variant="contained"
                    >
                        שלח
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
