"use client";
import React, { useEffect, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    useTheme,
    Alert,
} from "@/components/ui";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Shipment } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";
import SignatureCanvas from 'react-signature-canvas';
import { apiFetch } from "@/lib/api/client";

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
    const theme = useTheme();
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string; roles: string[] }[]>([]);
    const [history, setHistory] = useState<{ item_type_id: number; makat: number | null; total_sent: number }[]>([]);

    const [isSigned, setIsSigned] = useState(false);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isValid },
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
        }
    }, [open, shipment, reset]);

    const onSubmit = async (data: SendFormValues) => {
        if (!shipment) return;

        try {
            // Filter valid items
            const validItems = data.items.filter(i => i.item_type_id && Number(i.amount) > 0);
            if (validItems.length === 0) {
                alert("Please add at least one item to send.");
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
                onSend(true);
            } else {
                console.error("Failed to send shipment items");
                onSend(false);
            }
        } catch (error) {
            console.error(error);
            onSend(false);
        } finally {
            onClose();
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
            <DialogTitle sx={{
                fontWeight: 700,
                color: "text.primary",
                borderBottom: `1px solid ${theme.palette.divider}`,
                pb: 2
            }}>
                שליחת פריטים (Shipment Send)
            </DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        שים לב: ייתכן וישנם פריטים מחוברים (Sub-items)
                    </Alert>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: "100%" }}>
                            <Typography variant="subtitle1">
                                משלוח מקור: {shipment.shipment_code} | לקוח: {shipment.customer_code}
                            </Typography>
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel required>קוד משלוח יוצא</FieldLabel>
                            <Controller
                                name="sent_shipment_code"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        placeholder="קוד משלוח יוצא"
                                        fullWidth
                                        size="small"
                                        error={!!errors.sent_shipment_code}
                                        helperText={errors.sent_shipment_code?.message}
                                    />
                                )}
                            />
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel required>תאריך שליחה</FieldLabel>
                            <Controller
                                name="sent_date"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        type="date"
                                        fullWidth
                                        size="small"
                                        error={!!errors.sent_date}
                                        helperText={errors.sent_date?.message}
                                    />
                                )}
                            />
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel>עובד מוציא</FieldLabel>
                            <Controller
                                name="sending_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ worker_id: number; worker_name: string; roles: string[] }>
                                        options={workers.filter(w => w.roles.includes("storekeeper"))}
                                        getOptionLabel={(option) => option.worker_name}
                                        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(newValue) => {
                                            onChange(newValue?.worker_id ?? null);
                                            setValue("sending_worker_name", newValue?.worker_name ?? null);
                                        }}
                                        placeholder="בחר עובד…"
                                        error={!!errors.sending_worker_id}
                                    />
                                )}
                            />
                        </Box>
                    </Box>

                    {/* Dynamic Items Selection */}
                    <Box sx={{ mt: 3, borderTop: `1px solid ${theme.palette.divider}`, pt: 2 }}>
                        <Button variant="outlined" onClick={() => append({ item_type_id: null, makat: null, amount: '' })} sx={{ mb: 2 }}>
                            הוסף פריט לשליחה
                        </Button>
                        {fields.map((item, index) => (
                            <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                                <Controller
                                    name={`items.${index}` as const}
                                    control={control}
                                    rules={{
                                        validate: (val) => val.item_type_id ? true : "בחר פריט"
                                    }}
                                    render={({ field: { onChange, value } }) => (
                                        <Box sx={{ width: 400 }}>
                                            <SearchableCombobox<(typeof availableItems)[number]>
                                                options={availableItems}
                                                getOptionLabel={(option) =>
                                                    `${option.item_type_desc || 'Unknown'} - Makat: ${option.makat || 'N/A'} (Qty: ${option.quantity})`
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
                                                placeholder="בחירת פריט"
                                                error={!!errors.items?.[index]}
                                            />
                                        </Box>
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
                                                return `Max allowed is ${maxAllowed}`;
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
                                                label={`כמות (Max: ${maxAllowed})`}
                                                type="number"
                                                required
                                                size="small"
                                                sx={{ width: 160 }}
                                                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                                error={!!errors.items?.[index]?.amount}
                                                helperText={errors.items?.[index]?.amount ? (errors.items[index]?.amount?.message || "כמות לא תקינה") : ""}
                                            />
                                        );
                                    }}
                                />
                                <Button color="error" onClick={() => remove(index)}>
                                    מחק
                                </Button>
                            </Box>
                        ))}
                    </Box>

                    {/* Signature Section — compact */}
                    <Box sx={{ mt: 2, borderTop: `1px solid ${theme.palette.divider}`, pt: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>חתימה</Typography>
                            <Button size="small" onClick={() => sigCanvas.current?.clear()}>נקה חתימה</Button>
                        </Box>
                        <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: 'hidden', bgcolor: '#fafafa' }}>
                            <SignatureCanvas
                                ref={sigCanvas}
                                canvasProps={{ width: 800, height: 120, className: 'sigCanvas' }}
                                backgroundColor="#fafafa"
                                onEnd={() => setIsSigned(!sigCanvas.current?.isEmpty())}
                            />
                        </Box>
                    </Box>

                </DialogContent>
                <DialogActions sx={{ p: 3, gap: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
                    <Button
                        onClick={onClose}
                        variant="outlined"
                        sx={{ borderRadius: 9999, px: 3, borderColor: 'rgba(0,0,0,0.12)', color: 'text.primary' }}
                    >
                        ביטול
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isValid || !isSigned}
                        variant="contained"
                        color="success"
                        sx={{ borderRadius: 9999, px: 4, fontWeight: 700 }}
                    >
                        שלח
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
